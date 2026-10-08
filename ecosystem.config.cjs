// pm2 process definition. .cjs because package.json is "type": "module".
// Runs from the folder this file lives in, so the deployed .env is picked up.
module.exports = {
  apps: [
    {
      name: 'bmc-backend',
      script: 'dist/main.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
