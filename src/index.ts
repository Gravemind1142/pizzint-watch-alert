import dotenv from "dotenv";
import { start as startPizzaAlert } from "./pizzaAlert";
import { start as startNehAlert } from "./nothingEverHappens";
import { start as startCommuteAlert } from "./optempoAlert";

dotenv.config();

// Start modules
startPizzaAlert();
startNehAlert();
startCommuteAlert();

console.log("node start done");

