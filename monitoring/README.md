# Monitoring

Kubernetes replacement for the previous Docker Compose monitoring stack. Traefik
replaces the Nginx reverse proxy, and Prometheus uses in-cluster discovery instead
of a public API address and a copied bearer token.

## One-time setup

Create the Grafana password without committing it:

```sh
kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=password='REPLACE_WITH_A_STRONG_PASSWORD'
```

The wildcard TLS secret must also exist in `monitoring` because Kubernetes secrets
are namespace-scoped. If it currently exists in another namespace, copy/recreate
`devopsplamen-work-tls` in `monitoring` using your certificate-management method.

Point these DNS records at the cluster ingress address:

- `grafana.devopsplamen.work`

Apply `argocd/monitoring-application.yml` once (or add it to the bootstrap process),
then Argo CD manages everything under this directory.

Prometheus and Grafana also use PVCs, but old Docker volume contents are not copied
automatically.

Prometheus is intentionally not exposed by Ingress. Access its UI when needed with
`kubectl -n monitoring port-forward service/prometheus 9090:9090`.
