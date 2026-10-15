# Git pull command:
> git pull origin dev

# To pull database updates:
> npx prisma db pull

# To setup prisam sechma on your system:
> npm prisma generate

# Install google Oauth dependency:
> npm install passport-google-oauth20

# React icons for google auth:
> npm install react-icons

# If prisma migrate histroy issue (manual migrationn apply):
> npx prisma migrate resolve --added migrate_name

# Deploy to prisma
> npx prisma migrate deploy

# To check prisma status:
> npx prisma migrate status

# To rollback prisma migration:
> npm prisma migrate resolve --rolled-back migration_name

# Clean migration without data loss:
> npx prisma migrate dev --name migration_name
