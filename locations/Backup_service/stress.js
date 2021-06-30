import http from "k6/http";
import { sleep } from "k6";

export let options = {
  vus: 1000000,
  duration: "300s",
};

export default function () {
  http.get(
    "http://3.218.94.170:9696/getDrivers_walletInfosDeep?user_fingerprint=6fc0fbe78d093080ca60b1c534a1b7b5e171640dba4d796fb95337b88feb4befb6080417ede87759&transactionData=true&avoidCached_data=true"
  );
  sleep(1);
}
