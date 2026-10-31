# Tracker deployment

Tracker is configured at https://tracker.devopsplamen.work through the existing Traefik games-ingress. Its Service forwards port 80 to the application on port 3000. main/kustomization.yaml includes its Deployment, Service and dedicated 1Gi tracker-data PVC. The Deployment uses one replica and Recreate so the SQLite files are not shared by overlapping rollout Pods.

## Before syncing

The selected image is plamencode/tracker:2. GitHub build run 2 failed at Docker Hub login, so this tag has NOT been verified as published. Fix the DOCKER_USERNAME/DOCKER_PASSWORD repository secrets and successfully rerun build 2, or change the manifest to the tag of a later successful image build. Do not sync a missing image.

The existing expense-tracker-auth Secret must exist in services with the production authentication values. The app uses that login and the shared devops_private_auth cookie for .devopsplamen.work; local demo credentials and verification codes are not used in production. The dedicated volume stores car.db, money.db and auth.json. Existing standalone tracker databases and local Docker records are not imported automatically; a fresh volume receives the combined app's defaults.

DNS for tracker.devopsplamen.work must resolve to the existing ingress endpoint, and devopsplamen-work-tls must cover this hostname (a suitable wildcard certificate can cover it). The services namespace and a default StorageClass must exist. If the image is private on Docker Hub, configure the cluster's image-pull credentials through your existing secret/service-account setup.

The infra-services Argo Application watches main only. It will manage the new workloads after these files are committed and pushed, but infra/ingress.yml must be applied by its existing owner or, after review, from the repository root with kubectl apply -f infra/ingress.yml. This change does not move ingress ownership into that Application.

The tracker repository includes an infrastructure updater targeting main/tracker-deployment.yml. Once the image build and deployment work, configure INFRA_REPO_TOKEN and set ENABLE_INFRA_DEPLOY=true there if you want future successful builds to update the deployment tag automatically.
