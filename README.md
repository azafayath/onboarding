# Onboarding Planning Tool (Role-Based + Database)

This project upgrades your existing onboarding HTML into a production-ready web app:

- Login page with role-based access (`admin`, `user`)
- SQLite database for all planning selections and responder fields
- Admin-only full report access
- User role can complete planning selections but cannot open full summary report

## Project Structure

- `server.js` - Express server, auth, role checks, API, DB bootstrap
- `public/planner.html` - Original onboarding UI
- `public/auth-db-bridge.js` - Connects existing UI buttons to backend APIs
- `public/login.html` - Login screen
- `data/onboarding.db` - SQLite database (created at runtime)

## 1) Install prerequisites

Install Node.js 18+ on the EC2 server.

Then inside this project:

```bash
npm install
```

## 2) Configure environment

```bash
cp .env.example .env
```

Set a strong value in `.env`:

- `SESSION_SECRET=<strong-random-secret>`
- `PORT=3000` (or your preferred port)

## 3) Run

```bash
npm start
```

Open:

- `http://SERVER_IP:3000/login.html`

Default seeded admin account (change immediately):

- username: `admin`
- password: `Admin@123`

## 4) Create additional admins/users

Create admin:

```bash
node scripts/create-admin.js <username> <password>
```

Create user from API (while logged in as admin):

`POST /api/admin/users` with JSON body:

```json
{
  "username": "manager1",
  "password": "StrongPass123!",
  "role": "user",
  "displayName": "Line Manager 1"
}
```

## 5) EC2 + domain deployment (`onboarding.fip.edu.sa`)

Recommended setup:

1. Launch EC2 (Ubuntu), open ports 80/443 in Security Group
2. Install Node.js + Nginx
3. Run app with PM2:
   - `npm install`
   - `pm2 start server.js --name onboarding-tool`
   - `pm2 save`
4. Configure Nginx reverse proxy from `onboarding.fip.edu.sa` to `localhost:3000`
5. Use Certbot for SSL (HTTPS)

Basic Nginx server block:

```nginx
server {
    listen 80;
    server_name onboarding.fip.edu.sa;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Git workflow (professional baseline)

Once this folder is initialized as a git repository:

1. `git init`
2. `git checkout -b feat/auth-db-onboarding`
3. `git add .`
4. `git commit -m "Add role-based auth and DB persistence to onboarding tool"`
5. Push branch and open PR for review

## Notes

- Current report calculations remain exactly from your existing HTML logic.
- Future CEO-requested content/feature changes can now be implemented safely with backend persistence and role control.
