import "./style.css";

import startApp from "./mh/app/app.js";

// Vite и rollup-plugin-zigar настроены с включённым top-level await.
await startApp();
