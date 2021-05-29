module.exports = {
  apps: [
    /*{
      name: "Events gateway",
      script: "eventsGateway.js",
      instances: 3,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },*/
    {
      name: "Account service",
      script: "serverAccounts.js",
      instances: 30,
      autorestart: true,
      watch: false,
      max_memory_restart: "400Mb",
      env: {
        NODE_ENV: "production",
      },
    },
    /*{
      name: "Dispatch service",
      script: "serverDispatch.js",
      instances: 3,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Map service",
      script: "serverMap.js",
      instances: 3,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Pricing service",
      script: "serverPricing.js",
      instances: 3,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Search service",
      script: "serverSearch.js",
      instances: 3,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Payment service",
      script: "serverPayments.js",
      instances: 3,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "Watcher service",
      script: "serverWatcher.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },*/
  ],
};
