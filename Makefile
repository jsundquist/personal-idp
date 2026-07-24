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
	docker build -t $(IMAGE_NAME) ./backstage
	k3d image import $(IMAGE_NAME) -c $(CLUSTER_NAME)

deploy:
	cd terraform && terraform apply -auto-approve

destroy:
	cd terraform && terraform destroy -auto-approve
