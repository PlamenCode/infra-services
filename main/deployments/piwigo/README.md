# Piwigo family gallery

Included in the root `main/kustomization.yaml`, in namespace `services`.
URL: `https://piwigo.devopsplamen.work`, using the existing
`devopsplamen-work-tls` Secret through the shared `infra/ingress.yml` Ingress.
DNS must point at Traefik, and that certificate
must cover the hostname (or `*.devopsplamen.work`). No new TLS Secret is needed.

The old Immich manifests have already been removed from this repository.
This is a new Piwigo installation, not a migration of Immich's database or albums.

## Storage layout

The `piwigo-storagebox` static PV mounts only the **piwigo subdirectory** of
`//u713495-sub1.your-storagebox.de/u713495-sub1`. The sub-account's share still
maps to its existing `/immich/` directory in Hetzner; you do not need to rename
the sub-account. Piwigo stores original uploads under that subdirectory, leaving
the existing Immich folders alongside it. The 900 GiB capacity is binding metadata,
not a separately reserved or enforced quota on the shared Storage Box.

`/gallery` uses the SMB volume with UTF-8 and encryption. The local LinuxServer
`/config` volume holds settings, plugins, themes and generated thumbnails. MariaDB
has a separate local volume. Kubernetes mounts SMB through its CSI driver;
the host's `/mnt/storagebox1` mount is used only to prepare/check the directory.
Its read-only flag does not control the separate CSI mount.

| Claim | Storage | Requested size |
| --- | --- | --- |
| `piwigo-gallery` | Storage Box, Retain policy | 900 GiB |
| `piwigo-config` | local-path | 2 GiB |
| `piwigo-db` | local-path | 2 GiB |

Do not point Piwigo at Immich's existing `upload`/`library` directories. No data
conversion is performed here. Back up all three volumes and make database dumps;
the Storage Box holding live media is not a separate backup of that media.

## 1. Prepare the node and remote directory

On each eligible Linux node, ensure the SMB CSI driver and `nls_utf8` are available:

```bash
sudo modprobe nls_utf8
# Only if the module is missing on Ubuntu:
sudo apt-get update
sudo apt-get install -y "linux-modules-extra-$(uname -r)"
sudo modprobe nls_utf8
kubectl get csidriver smb.csi.k8s.io
```

After kernel upgrades, ensure the corresponding extra modules are installed too.
The sub-account must have SMB and write access. Enable external reachability if
nodes connect from outside Hetzner. Nodes must resolve the share hostname and
reach TCP 445. Argo CD needs permission to manage PersistentVolumes.

On the server where `/mnt/storagebox1` is already mounted, create the isolated
directory. The guard prevents accidentally creating a local directory instead:

```bash
(
  set -e
  mountpoint -q /mnt/storagebox1 || {
    echo 'Mount the Storage Box at /mnt/storagebox1 first' >&2
    exit 1
  }
  sudo mount -o remount,rw /mnt/storagebox1
  sudo mkdir -p /mnt/storagebox1/piwigo
  sudo ls -ld /mnt/storagebox1/piwigo
)
```

The static CSI `subDir` must exist before Piwigo starts. You may unmount the
manual host mount afterwards; Kubernetes establishes its own mount.

## 2. Copy the existing Secrets under Piwigo names

Kubernetes Secrets cannot be renamed in place. This helper reads the existing
Secrets, creates new copies with minimal metadata, and prints only object names.
It preserves the base64 data exactly, including non-ASCII passwords.
It refuses to overwrite an existing target with different data.

```bash
cd ~/infra-services
python3 main/deployments/piwigo/copy-secrets.py
kubectl -n services describe secret piwigo-prod
kubectl -n services describe secret piwigo-storagebox
```

| Original | New name | Keys |
| --- | --- | --- |
| `immich-prod` | `piwigo-prod` | `USERNAME`, `PASSWORD`, `DB_PASSWORD` |
| `immich-storagebox` | `piwigo-storagebox` | `username`, `password`, optional `domain` |

Keep key casing exactly as above. `DB_PASSWORD` initializes a **new MariaDB**
database/user, both named `piwigo`. Immich's old PostgreSQL volume is not reused.
MariaDB generates its own root password; Piwigo connects as the restricted
`piwigo` database user. After initialization, Secret changes do not rotate the
password stored in MariaDB automatically.

`USERNAME` and `PASSWORD` are retained as your desired Piwigo admin credentials.
The image does not automatically provision an admin from these keys: enter the
same values in Piwigo's web installer. No custom account bootstrap is installed.

Do not commit Secret manifests or paste decoded credentials into chat.
The original Secrets remain until you verify Piwigo and stop any old Immich
workloads that still reference them. If they were already deleted, recreate the
new names from your password manager using `stringData`, not plain text in `data`.

## 3. Deploy and replace the public route

Both Piwigo and MariaDB have one replica. Stop obsolete Immich workloads before
syncing to avoid running both stacks on the shared node. If present, set
`immich`, `immich-postgres` and `immich-valkey` Deployments to zero; leave their
storage intact. A removed manifest is not deleted automatically because the
repository's Argo CD Application has pruning disabled.

Create Secrets and the remote directory **before** syncing the new manifests.
Then sync the existing Argo CD Application or apply Kustomize:

```bash
cd ~/infra-services
kubectl apply -k main/
kubectl apply -f infra/ingress.yml
kubectl -n services rollout status deployment/piwigo-db --timeout=5m
kubectl -n services rollout status deployment/piwigo --timeout=10m
kubectl -n services logs deployment/piwigo -c storage-check
kubectl -n services get pvc
```

Point DNS `piwigo.devopsplamen.work` to your ingress address. The shared Ingress
`games-ingress` routes that hostname to the `piwigo` Service. The Argo Application
watching `main/` does not apply `infra/ingress.yml`; apply it separately or use
the existing infra update script. After applying the shared route, remove any
previous standalone Piwigo/Immich Ingresses to avoid duplicate hostname routes.
Pruning is disabled in this repository's Argo Application, so removing a manifest
alone does not delete the live object. These commands do not remove media or
database data:

```bash
kubectl -n services delete ingress piwigo immich --ignore-not-found
```

## 4. Finish Piwigo installation

Open `https://piwigo.devopsplamen.work` and complete the web installer promptly:

| Installer field | Value |
| --- | --- |
| Database host | `piwigo-db` |
| Database username | `piwigo` |
| Database password | Value of `DB_PASSWORD` in `piwigo-prod` |
| Database name | `piwigo` |
| Table prefix | `piwigo_` |
| Admin username | Value of `USERNAME` in `piwigo-prod` (the previous email is valid as a login) |
| Admin password | Value of `PASSWORD` in `piwigo-prod` |
| Admin email | Your email address |

The installer saves its database connection settings on the persistent `/config`
volume. Do not change database credentials by changing the Secret alone.

Upload a small photo first, check it appears under `/mnt/storagebox1/piwigo/upload`
if the manual mount is active, restart Piwigo, and verify the photo remains visible.
The runtime image and resource tuning have not been tested against your live node.

Install the **Community** plugin for uploads by non-admin family members.
Create a private album for each person, grant access to that person and the admin,
and scope Community upload permissions to the relevant album. Set new albums
private by default; Piwigo's initial defaults can otherwise expose public albums.
Admin management can access all photos; gallery browsing still obeys album rights.
Test isolation using two family accounts before importing a full library.
Use the official iOS app for uploads and its documented automatic-upload setup.
Videos may need the VideoJS plugin and should be tested separately.

After Piwigo works and no old Immich Pods/PVs need the original Secrets, you can
complete the rename by deleting only the originals:

```bash
kubectl -n services delete secret immich-prod immich-storagebox
```

## Resources and troubleshooting

The app requests 256 MiB and is limited to 512 MiB/0.5 CPU. MariaDB requests
128 MiB and is limited to 384 MiB/0.3 CPU, with a 64 MiB InnoDB buffer pool and
20 connections. PHP uses at most two on-demand workers with a 128 MiB per-request
limit. These settings contain resource use; they are not a capacity guarantee.
Large photos may exceed limits. Uploads are initially limited to 100 MiB per file.
Monitor local disk too: thumbnails and plugins consume the `/config` volume.

Given the previous node outage, check `free -h` and `kubectl top nodes` before
starting. Import one small album at a time. If the node remains overloaded,
stop the gallery and free capacity rather than lowering reservations again.
For a persistent pause set both Deployment `replicas` to `0` in Git and sync.

```bash
kubectl -n services get pods -l app=piwigo
kubectl -n services describe pods -l app=piwigo
kubectl -n services logs deployment/piwigo -c piwigo --tail=60
kubectl -n services logs deployment/piwigo-db --tail=60
```

Local validation: `kubectl kustomize main`. Always use `apply -k main`, not a
recursive raw apply. The latter applies templates/configuration as resources.

Sources: [LinuxServer image](https://docs.linuxserver.io/images/docker-piwigo/),
[Community plugin](https://piwigo.org/ext/index.php?eid=303),
[user roles](https://doc.piwigo.org/managing-users/user-statuses/),
[private albums](https://doc.piwigo.org/organizing-albums/permissions-and-album-visibility/),
[iOS auto-upload](https://github.com/Piwigo/Piwigo-Mobile/wiki/Auto%E2%80%90Uploading).
