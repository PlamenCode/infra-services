# Immich family deployment

Included in `main/kustomization.yaml`, so the existing Argo CD Application renders
this stack in namespace `services`. Server and machine learning are pinned to
v3.3.6; database and Valkey images match that release's official Compose file.

## Required Secrets and DNS

Create these Secrets in `services` before syncing. Do not commit real credentials.

| Secret | Keys | Purpose |
| --- | --- | --- |
| `immich-prod` | `USERNAME`, `PASSWORD`, `DB_PASSWORD` | Admin email/password and a separate PostgreSQL password. |
| `immich-storagebox` | `username`, `password` | SMB sub-account `u713495-sub1` and its password; driver requires lowercase keys. |
| `devopsplamen-work-tls` | `tls.crt`, `tls.key` | Existing TLS Secret; must cover `immich.devopsplamen.work`. |

The uppercase requirement applies to the key names, not the credential values.
Create the admin Secret through your Kubernetes secret manager or a local,
untracked file, for example:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: immich-prod
  namespace: services
type: Opaque
stringData:
  USERNAME: 'admin@example.com'
  PASSWORD: 'REPLACE_WITH_A_LONG_UNIQUE_PASSWORD'
  DB_PASSWORD: 'REPLACE_WITH_A_DIFFERENT_DATABASE_PASSWORD'
```

Use `stringData` for plain-text values. The `data` field requires base64-encoded
values; putting plain text there causes `illegal base64 data at input byte ...`.
When editing an existing Secret, remove the old `data` entries for these same
keys and supply all three values under `stringData`. Kubernetes encodes them
when storing the Secret. Do not base64-encode values placed under `stringData`.

Ensure namespace `services` exists before creating the Secret. Point
`immich.devopsplamen.work` at your Traefik ingress address. The Ingress reuses
`devopsplamen-work-tls` from `services`; its certificate must include this hostname
or `*.devopsplamen.work`. Existing certificate coverage has not been verified live.
No separate `immich-db` or `immich-tls` Secret is needed.

If PostgreSQL has already initialized, preserve its existing database password
as `DB_PASSWORD`: changing the Secret does not change the password stored in
PostgreSQL. Coordinate any future database password rotation with PostgreSQL.

## Startup and credentials

Immich has no native admin username/password environment-variable provisioning.
The bootstrap sidecar reads `immich-prod`, waits for the local API, and registers
the first admin only when the database is uninitialized. It then logs in and
checks `isAdmin`, logs out, and marks the Pod ready. The public Service does not
route traffic before that check succeeds. Do not enable `publishNotReadyAddresses`
or expose the Pod directly during setup. This gate protects ingress setup, not
against untrusted workloads with direct Pod-network access.

On later Pod starts the credentials must still match the existing administrator.
The script never resets passwords or overwrites an existing account. Updating
the Secret alone does not change the Immich password. Change the password in
Immich and update `immich-prod` together before restarting the Deployment.
A mismatch intentionally leaves the Pod unready; check the `admin-bootstrap` logs.

## Family accounts and visibility limitation

Log in at `https://immich.devopsplamen.work`, finish onboarding, then use
**Administration > Users > Create user** for each family member. Leave these
accounts non-admin. Each person logs in with their own email/password and uploads
through the web UI or the Immich mobile app using this same server URL.

**Stock Immich cannot enforce “the admin can see absolutely everything uploaded,
and nobody else can share it.”** The admin role manages accounts/settings; it does
not give an all-user photo browser. This deployment does not change that model.

For the closest built-in arrangement, each family member opens
**Account Settings > Sharing / Partner Sharing** and adds only the admin as a
partner. Sharing is one-way: do not add family members as partners of the admin,
and do not share between family accounts. The admin can enable **Show in timeline**
for each shared library. New eligible uploads are then visible to the admin.

Partner Sharing is revocable and has exclusions (including archived/locked
content and some metadata); it is not mandatory administrator oversight or full
control over other users' assets. Users can still choose to share albums/links
with others. If unconditional access to every asset is required, this setup does
not meet that requirement; application changes or a different access model are
needed. Kubernetes manifests cannot add those application permissions.

References: [user management](https://docs.immich.app/administration/user-management/),
[partner sharing](https://docs.immich.app/features/partner-sharing/),
[locked folder](https://docs.immich.app/features/locked-folder/).

## Storage and deployment checks

Photos/videos use `immich-library-storagebox`, a static SMB claim bound to the
Retain-policy PV `immich-storagebox`. The encrypted SMB mount uses
`//u713495-sub1.your-storagebox.de/u713495-sub1`; this share already maps to
the sub-account's `/immich/` directory. Do not append that directory again.
The 900 GiB request is binding metadata, not an enforced Storage Box quota.
An init container checks read/write access before Immich starts; an unavailable
mount prevents startup rather than falling back to local photo storage.

PostgreSQL (10 GiB), model cache (10 GiB), and Valkey (1 GiB) stay on
`local-path`. The original 100 GiB `immich-library` claim remains declared to
preserve any existing uploads, but is no longer mounted by the server.
Local-path storage is tied to a node; monitor actual disk free space. Single
replicas and Recreate rollouts mean updates interrupt service. Back up both the
photo volume and PostgreSQL to another device/location and test restoration.
Back up before upgrades and keep server/mobile versions compatible.

Before syncing, install the SMB CSI driver (`smb.csi.k8s.io`) and create the
following Secret locally outside Git, replacing only the password:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: immich-storagebox
  namespace: services
type: Opaque
stringData:
  username: 'u713495-sub1'
  password: 'REPLACE_WITH_SUBACCOUNT_PASSWORD'
```

SMB and read/write access must be enabled for this Hetzner sub-account.
Enable External Reachability when nodes are outside Hetzner. Nodes must resolve
the Storage Box hostname and reach outbound TCP 445. Argo CD must be allowed to
manage cluster-scoped PersistentVolumes. No Storage Box password is stored here.

For an existing installation with uploads, pause Argo automatic sync and stop
Immich before switching. Back up PostgreSQL and the old photo volume, then use
a temporary copy Pod mounting both claims to copy the entire library, including
hidden `.immich` markers, preserving relative paths. Verify checksums before
deploying the new claim reference. Keep the old claim until restoration and
application access are verified. This repository does not migrate existing data.
For a fresh installation, no migration is needed.

```powershell
kubectl kustomize main
# After creating Secrets, sync the existing Argo CD Application or apply:
kubectl apply -k main
kubectl -n services rollout status deployment/immich --timeout=20m
kubectl -n services logs deployment/immich -c storage-check
kubectl -n services logs deployment/immich -c admin-bootstrap
kubectl -n services get pvc
kubectl -n services get ingress immich
```

Expected storage-check output: `Storage Box read/write check passed`.
If the Pod is stuck mounting, inspect `kubectl -n services describe pod POD_NAME`.
After a photo/video upload, verify playback, restart the Deployment, and verify
the same assets again. Local rendering cannot verify remote SMB connectivity.

Verify HTTPS, admin login, and an upload from two separate family accounts.
Before sharing, neither family account should see the other's photos and the
admin should not see them. After one-way sharing to the admin, confirm the admin
can see each eligible upload and family accounts still cannot see one another's
libraries. Also test a large video upload; Traefik's entrypoint read timeout may
need increasing for slow uploads (configured on Traefik, not this Ingress).

Local checks: `kubectl kustomize main` and
`node --test main/deployments/immich/bootstrap.test.mjs`.
No live cluster validation is implied by these checks.
