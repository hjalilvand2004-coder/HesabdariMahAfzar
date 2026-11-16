// ساخت فایل پرتیبل تک‌فایلی: تزریق JS/CSS داخل HTML + پیام پرتیبل
import fs from 'node:fs'
import path from 'node:path'

const FRONT = new URL('../frontend', import.meta.url).pathname
const DIST = path.join(FRONT, 'dist')
const OUT = new URL('../Maliyar-Portable.html', import.meta.url).pathname

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8')

// پیدا کردن assetها از index.html
const cssFile = [...html.matchAll(/href="(\/assets\/[^"]+\.css)"/g)].map(m => m[1])
const jsFile = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => m[1])

if (!cssFile.length || !jsFile.length) {
  console.error('assetها در index.html یافت نشد!')
  process.exit(1)
}

const css = fs.readFileSync(path.join(DIST, cssFile[0].slice(1)), 'utf-8')
const js = fs.readFileSync(path.join(DIST, jsFile[0].slice(1)), 'utf-8')

// در حالت portable باید __PORTABLE__ مقدار true باشد؛ در build متعارف undefined است.
// جلوگیری از شکستن تگ اسکریپت توسط رشته </script> داخل باندل:
const jsSafe = js.replace(/<\/script/gi, '<\\/script')
const cssSafe = css.replace(/<\/style/gi, '<\\/style')
// نکته مهم: با تابع جایگزین — چون در رشته جایگزین، الگوهای $& و $' تعبیر می‌شوند!
let out = html
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${cssSafe}\n</style>`)
  .replace(/<script type="module"[^>]*><\/script>/, () => `<script type="module">\n${jsSafe}\n</script>`)

// پیام پرتیبل در بارگذاری اولیه
out = out.replace('<title>', '<meta name="portable" content="1" />\n<title>')

fs.writeFileSync(OUT, out)
const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2)
console.log(`✅ فایل پرتیبل ساخته شد: ${OUT} (${sizeMB} MB)`)

// بررسی: موتور local، فونت و رشته‌های فارسی داخل فایل هستند (نام توابع minify می‌شوند)
const check = out.includes('maliyar_db_v1') && out.includes('Vazirmatn') &&
  out.includes('نام کاربری یا رمز عبور نادرست است') && out.includes('سند نامتوازن است')
console.log(check ? '✅ محتوای موتور، فونت و منطق مالی داخل فایل تأیید شد' : '⛔ محتوا ناقص است!')
process.exit(check ? 0 : 1)
