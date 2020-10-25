module.exports = {
  apps: [
    {
      script: "serverMap.js",
      watch: false,
      instances: 2,
      exec_mode: "cluster",
      env_production: {
        NODE_ENV: "production",
      },
      max_memory_restart: "1G",
      node_args: "--max_old_space_size=900",
      args: ["--max_old_space_size=900"],
    },
  ],

  deploy: {
    production: {
      "pre-deploy-local": "",
      "post-deploy": "npm install && pm2 reload ecosystem.config.js --env production",
      "pre-setup": "",
    },
  },
};
