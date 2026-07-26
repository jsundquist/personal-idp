.PHONY: all cluster-up cluster-down build deploy argocd-bootstrap argocd-ui camunda-bootstrap operate-ui tasklist-ui destroy

# nvm is a shell function, so the host-side build steps must run under bash (not /bin/sh).
SHELL := /bin/bash

CLUSTER_NAME = personal-idp
IMAGE_NAME   = backstage:local

all: cluster-up build deploy argocd-bootstrap

cluster-up:
	k3d cluster create $(CLUSTER_NAME) \
		--port "8080:80@loadbalancer" \
		--agents 1

cluster-down:
	k3d cluster delete $(CLUSTER_NAME)

# The host-side yarn steps must run under Node 24 (backstage/.nvmrc); the default
# system node (e.g. Homebrew 26) breaks the native isolated-vm build. Source nvm and
# `nvm use` (reads .nvmrc after cd) so the build is correct regardless of the caller's
# default node; `nvm install` covers a machine that doesn't have 24 yet.
build:
	export NVM_DIR="$$HOME/.nvm" && . "$$NVM_DIR/nvm.sh" && cd backstage && \
	  { nvm use || nvm install; } && \
	  yarn install --immutable && yarn tsc && yarn build:backend
	docker build -t $(IMAGE_NAME) -f backstage/packages/backend/Dockerfile backstage/
	k3d image import $(IMAGE_NAME) -c $(CLUSTER_NAME)

deploy:
	cd terraform && terraform apply -auto-approve

# Register the backstage ArgoCD Application after ArgoCD CRDs are available.
# Run once after `make deploy` on a fresh cluster.
argocd-bootstrap:
	kubectl wait --for=condition=available deployment/argocd-server -n argocd --timeout=120s
	kubectl apply -f k8s/argocd/backstage-application.yaml

# Open the ArgoCD UI via port-forward (ArgoCD runs on port 8080 internally).
argocd-ui:
	kubectl port-forward svc/argocd-server -n argocd 8088:80

# Register the Camunda ArgoCD Application (official camunda-platform Helm chart, trimmed for local).
# Run once after ArgoCD is available; ArgoCD then syncs the stack into the `camunda` namespace.
camunda-bootstrap:
	kubectl wait --for=condition=available deployment/argocd-server -n argocd --timeout=120s
	kubectl apply -f k8s/argocd/camunda-application.yaml

# Open the Camunda Operate UI (workflow instances) via port-forward. Login: demo / demo.
operate-ui:
	kubectl port-forward svc/camunda-operate -n camunda 8081:80

# Open the Camunda Tasklist UI (user tasks) via port-forward. Login: demo / demo.
tasklist-ui:
	kubectl port-forward svc/camunda-tasklist -n camunda 8082:80

destroy:
	cd terraform && terraform destroy
