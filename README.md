# A.H State Agency Pro — Multi-User Property CRM

## Features
- Admin + Partner login
- Shared SQLite database
- Live updates between logged-in devices using Socket.IO
- Houses/flats/portions/shops/offices/plots
- Rent and Sale listings
- Customer demands: Rent / Purchase / Sell
- Smart property-to-customer matching
- Team activity log
- Admin can add/delete team users
- Change password
- Search and filters
- Mobile-friendly UI

## Run on a computer/server
1. Install Node.js 18+.
2. Open this folder in Terminal.
3. Run:
   `npm install`
4. Start:
   `npm start`
5. Open:
   `http://localhost:3000`

## First login
- Admin: `admin`
- Password: `Admin@12345`
- Partner: `partner`
- Password: `Partner@12345`

**Immediately change the passwords from Settings.**

## Make it available on phones
The app needs to run on a server that both phones can reach. For internet access, deploy this Node app to a VPS/cloud host and use HTTPS. Set a strong `SESSION_SECRET` environment variable.

## Important
The database is `data.db` and contains your CRM data. Back it up regularly. For production use, use HTTPS and a strong session secret.


## Online deployment

This package includes a Dockerfile and a Render blueprint.

### Recommended setup
1. Create a GitHub repository and upload this folder.
2. Create a Render Web Service from the repository.
3. Use the included `render.yaml` or configure the service as a Docker service.
4. Keep persistent storage mounted because the SQLite database (`data.db`) must survive restarts.
5. Use HTTPS and keep the generated `SESSION_SECRET`.
6. After deployment, open the HTTPS URL on your phone and your partner's phone.

### Before sharing
- Change both default passwords.
- Add your real partner account from Team Users.
- Do not share the default credentials.
- Keep regular backups of `data.db`.

### Important limitation
I can create the complete deploy-ready software here, but I cannot create a third-party hosting account, accept its terms, or deploy into your private account without access to that hosting service. The included files are prepared for the online deployment step.
