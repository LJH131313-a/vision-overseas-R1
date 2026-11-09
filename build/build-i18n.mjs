#!/usr/bin/env node
/* 由 data/i18n-en.json 生成浏览器可用的词条脚本（file:// 直开也能用） */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const src = JSON.parse(readFileSync(join(ROOT, "data/i18n-en.json"), "utf-8"));
const js = "/*! 中英双语词条（build/build-i18n.mjs 生成） */\nwindow.VO_I18N_EN = " + JSON.stringify(src) + ";\n";
writeFileSync(join(ROOT, "data/i18n-en.js"), js, "utf-8");
console.log("[i18n] 词条", Object.keys(src.entries).length, "条 → data/i18n-en.js");
