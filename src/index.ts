import dotenv from "dotenv";
import { checkAndAlert } from "./pizzaAlert";
import { checkAndAlert as checkAndAlertNeh } from "./nothingEverHappens";
import { checkAndAlertCommute } from "./optempoAlert";

dotenv.config();

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Start immediately
checkAndAlert();
checkAndAlertNeh();
checkAndAlertCommute();

// Schedule every 15 minutes
setInterval(() => {
    checkAndAlert();
    checkAndAlertNeh();
    checkAndAlertCommute();
}, INTERVAL_MS);

console.log("node start done");
