#!/bin/bash

# Exit on error
set -e

# Check if we have the required arguments
if [ "$#" -lt 4 ]; then
    echo "Usage: $0 <devicePath> <database> <username> <password>"
    exit 1
fi

devicePath="$1"
DATABASE="$2"
USERNAME="$3"
PASSWORF="$4"

# Check if the volume needs to be formatted (first time only)
if [ "$(file -s ${devicePath})" = "${devicePath}: data" ]; then
  mkfs -t xfs ${devicePath}
fi

# Create mount point
mkdir -p /var/lib/postgresql/data

# Add to fstab if entry doesn't exist
if ! grep -q "${devicePath} /var/lib/postgresql/data" /etc/fstab; then
  echo "${devicePath} /var/lib/postgresql/data xfs defaults,nofail 0 2" >> /etc/fstab
fi

# Mount all
mount -a

# Set ownership
chown postgres:postgres /var/lib/postgresql/data

# Set PGDATA environment variable before initialization
echo "PGDATA=/var/lib/postgresql/data" > /etc/sysconfig/postgresql

# Initialize PostgreSQL if not already initialized
if [ ! -f "/var/lib/postgresql/data/PG_VERSION" ]; then
    postgresql-setup --initdb --pgdata=/var/lib/postgresql/data
fi

# Start PostgreSQL if not running
systemctl start postgresql
systemctl enable postgresql

# Wait for PostgreSQL to be ready
until pg_isready; do
    echo "Waiting for PostgreSQL to be ready..."
    sleep 1
done

# Create user if it doesn't exist
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$USERNAME'" | grep -q 1; then
    echo "Creating user $USERNAME..."
    sudo -u postgres psql -c "CREATE USER $USERNAME WITH PASSWORD '$USERNAME'"
else
    echo "User $USERNAME already exists"
fi

# Create database if it doesn't exist
if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw "$DATABASE"; then
    echo "Creating database $DATABASE..."
    sudo -u postgres psql -c "CREATE DATABASE $DATABASE"
else
    echo "Database $DATABASE already exists"
fi

# Grant privileges to user (these operations are idempotent)
echo "Ensuring correct privileges..."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DATABASE TO $USERNAME"
sudo -u postgres psql "$DATABASE" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $USERNAME"
sudo -u postgres psql "$DATABASE" -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $USERNAME"
sudo -u postgres psql "$DATABASE" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $USERNAME"
sudo -u postgres psql "$DATABASE" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $USERNAME"

# Update pg_hba.conf to allow password authentication for the user if not already configured
PG_HBA_CONF="/var/lib/postgresql/data/pg_hba.conf"
if ! grep -q "^host.*$DATABASE.*$USERNAME.*md5" "$PG_HBA_CONF"; then
    echo "host    $DATABASE    $USERNAME    0.0.0.0/0    md5" >> "$PG_HBA_CONF"
    # Reload PostgreSQL to apply the new configuration
    systemctl reload postgresql
fi

echo "Database setup complete"
