// PM2 process file — `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup`
module.exports = {
  apps: [
    {
      name: 'xyvera-md',
      script: 'src/index.js',
      cwd: require('node:path').resolve(__dirname, '..'),
      instances: 1, // JSON store is single-writer — never run more than one
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      // Exit 2 = session logged out: stop looping and wait for the operator.
      // Exit 75 = restart requested: restart immediately.
      exp_backoff_restart_delay: 2000,
      time: true,
    },
  ],
};
