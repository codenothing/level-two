#!/bin/bash
cd "$(dirname "$0")"

docker-compose -f docker-e2e.yml up -d