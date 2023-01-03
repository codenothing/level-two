#!/bin/bash
cd "$(dirname "$0")"

MYSQL_PWD=$MYSQL_BENCHMARK_PASSWORD mysql -u $MYSQL_BENCHMARK_USER $MYSQL_BENCHMARK_DATABASE < setup.sql

echo "Running Baseline..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./baseline.ts

echo ""
echo "Running MySQL Comparison..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./mysql.ts

echo ""
echo "Running Redis Comparison..."
../node_modules/.bin/ts-node --project ../tsconfig.benchmark.json ./redis.ts
