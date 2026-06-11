# Command: deploy

Deploy backend or dashboard changes to production (AWS Elastic Beanstalk / S3).

## Pre-flight checklist

Before deploying:
- [ ] All tests pass locally: `npm run lint && npm run build && npm test`
- [ ] You are on `main` branch with `dev` merged in
- [ ] No pending DB migrations that could break the running instance during deploy
- [ ] Check current production health: `curl http://llm-gateway-prod.eba-cd8vjbc9.ap-south-1.elasticbeanstalk.com/health`

## Deploy backend (API)

```bash
# Merge dev into main
git checkout main && git merge dev

# Push to trigger EB deploy
git push origin main

# Deploy to Elastic Beanstalk
eb deploy llm-gateway-prod

# Monitor deploy progress
eb status llm-gateway-prod

# Check logs if something looks wrong
eb logs --all
```

**Zero-downtime note:** The EB environment is a single t3.micro with no load balancer.
There is a brief window (~30s) during container restart where the API is unavailable.
Schedule deploys during low-traffic periods.

## Run DB migrations in production

Migrations must be run **before** deploying code that depends on them (additive) or
**after** deploying code that removes deprecated columns (subtractive).

```bash
DATABASE_URL=postgresql://gateway:GatewayProd2026Secure@llm-gateway-db.c9yy6u48ofas.ap-south-1.rds.amazonaws.com:5432/llmgateway \
  npx prisma migrate deploy
```

Your local IP must be allowed on port 5432 in security group `sg-0a68ef2d0064bc41f`.
Current allowed IP: 49.206.98.145 (update if your IP has changed).

## Deploy dashboard (S3 static site)

```bash
cd dashboard

# Build with production API URL
VITE_API_URL=http://llm-gateway-prod.eba-cd8vjbc9.ap-south-1.elasticbeanstalk.com \
  npm run build

# Sync to S3 (overwrites existing files, does not delete removed files)
aws s3 sync dist/ s3://llm-gateway-dashboard-937083180480

# To also delete files removed from dist/:
aws s3 sync dist/ s3://llm-gateway-dashboard-937083180480 --delete
```

Dashboard is available at:
http://llm-gateway-dashboard-937083180480.s3-website.ap-south-1.amazonaws.com

## SSH into the EC2 instance

```bash
eb ssh llm-gateway-prod
```

Once inside:
```bash
docker ps                              # see running container
docker logs <container-id> --tail 100  # recent logs
```

## Post-deploy verification

```bash
# Health check
curl http://llm-gateway-prod.eba-cd8vjbc9.ap-south-1.elasticbeanstalk.com/health

# Readiness check
curl http://llm-gateway-prod.eba-cd8vjbc9.ap-south-1.elasticbeanstalk.com/health/ready

# Quick API smoke test (replace with production key)
curl -X POST \
  http://llm-gateway-prod.eba-cd8vjbc9.ap-south-1.elasticbeanstalk.com/v1/chat/completions \
  -H "Authorization: Bearer lgk_cc2fd1f97791fe77a4fb4c1a59cd54c130f6ddfb7c8fb650adf52cfde4ad1616" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
```

## Rollback

EB keeps the previous application version. To roll back:

```bash
eb deploy --version <previous-version-label>
```

List available versions:
```bash
aws elasticbeanstalk describe-application-versions \
  --application-name llm-gateway \
  --query 'ApplicationVersions[*].[VersionLabel,DateCreated]' \
  --output table
```
