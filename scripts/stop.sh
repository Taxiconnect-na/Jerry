#!/bin/bash

(cd /home/ubuntu/Jerry ; sudo docker-compose down)
sudo docker system prune --all --force