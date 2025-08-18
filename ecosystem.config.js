module.exports = {
  apps: [{
    name: 'WishMaster',
    script: 'app.js',
    instances: 'max',        // number of instances (or 'max' for all CPUs)
    exec_mode: 'cluster',   // enables clustering
    autorestart: true,      // auto-restart if app crashes
    watch: false,           // enable file watching (development only)
    max_memory_restart: '1G', // restart if memory exceeds 1GB
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    }
  }]
};