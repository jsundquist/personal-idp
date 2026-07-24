.PHONY: all cluster-up cluster-down build deploy destroy

CLUSTER_NAME = personal-idp
IMAGE_NAME   = backstage:local

all: cluster-up build deploy

cluster-up:
	k3d cluster create $(CLUSTER_NAME) \
		--port "8080:80@loadbalancer" \
		--agents 1

cluster-down:
	k3d cluster delete $(CLUSTER_NAME)

build:
	cd backstage && yarn install --immutable && yarn tsc && yarn build:backend
	docker build -t $(IMAGE_NAME) -f backstage/packages/backend/Dockerfile backstage/
	k3d image import $(IMAGE_NAME) -c $(CLUSTER_NAME)

deploy:
	cd terraform && terraform apply -auto-approve

destroy:
	cd terraform && terraform destroy -auto-approve
