# Baseball Quest — Shareable Prototype

This is a static mobile web app. It needs to be opened from a normal HTTPS website for reliable interaction on iPhone.

## Fastest way to share it: GitHub Pages

1. Create a new GitHub repository, for example `baseball-quest`.
2. Upload these three files to the root of the repository:
   - `index.html`
   - `manifest.json`
   - `service-worker.js`
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. GitHub will give you a public HTTPS link such as:
   `https://YOURUSERNAME.github.io/baseball-quest/`
7. Send that link to the other coach.

## iPhone use

Open the HTTPS link in Safari. The app should be interactive. If desired, use Share → Add to Home Screen.

## Important limitation of this prototype

Progress is stored locally on each device. There are no accounts and no shared coach dashboard yet. This is ideal for demonstrating the concept. A production/team version should add a database, player accounts, and coach controls.
