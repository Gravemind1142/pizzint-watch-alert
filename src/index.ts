import dotenv from "dotenv";
import { checkAndAlert } from "./pizzaAlert";

dotenv.config();

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Start immediately
checkAndAlert();

// Schedule every 15 minutes
setInterval(checkAndAlert, INTERVAL_MS);

console.log("node start done");
