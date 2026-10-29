import { app } from "./app.js";
import { env } from "./env.js";

app.listen(env.port, () => {
  console.log(`CampusConnect API listening on port ${env.port}`);
});
