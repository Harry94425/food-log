# 飲食紀錄（food-log）

AI 飲食紀錄 App（Android，Expo）。拍照讓 AI 估算熱量與三大營養素，掃條碼帶入包裝食品，運動從 Strava 自動匯入；資料只存在手機裡。

## 功能

- **記餐點**：拍照或選照片，AI（Gemini 免費／GPT 付費）辨識品項、份量、熱量、蛋白質、碳水、脂肪；拍營養標示會照抄數字
- **掃條碼**：先查自己記過的商品，再查 Open Food Facts；都查不到就拍一次營養標示，AI 讀完記在條碼底下，下次直接帶入
- **手動輸入**：打食物名稱會提示吃過的品項；打完自動帶入（吃過的優先，沒有就 AI 估算）；改蛋白質、碳水、脂肪自動算熱量（4/4/9）
- **吃過的餐點**：搜尋店家或餐名，一鍵帶入名稱、店家、價錢、品項
- **餐點資訊**：餐別（早餐、午餐、晚餐、宵夜、點心、飲料、補給）、名稱、店家、價錢、日期；存了可以再編輯
- **每日目標**：第一次打開先填基本資料（性別、年齡、身高、體重、增肌／維持／減脂、運動量），讓 AI 或公式設定熱量與三大營養素；騎車等運動消耗自動加進當天目標，用碳水補
- **Strava**：連結後打開「今天」頁就會補齊新活動，以 Strava 為準（在 Strava 改名、刪除會跟著改）；重訓記 0 kcal（已含在目標裡）
- **體重**：每天輸入，歷史頁看每週平均，兩週沒增加會提醒多吃
- **歷史**：最近 30 天每天一列，沒記、缺午餐或晚餐會標出來；熱量、蛋白質達標率；本月、上月餐費
- **提醒**：午餐、晚餐時間還沒記就通知，點通知直接新增
- **深色模式**：跟著手機切換
- **匯出**：設定頁可匯出 CSV

## 安裝

1. 到 [Releases](../../releases/latest) 下載 `food-log.apk`，在 Android 手機上安裝（要允許「安裝不明來源的應用程式」；只支援 64 位元 arm64 手機）
2. 到 [Google AI Studio](https://aistudio.google.com/apikey) 申請免費的 Gemini API 金鑰
3. 第一次打開會請你填基本資料並貼上金鑰，AI 會幫你設定每日目標（沒有金鑰也可以用公式估算）
4. 要串 Strava 的話，到 [Strava API 設定](https://www.strava.com/settings/api) 建立自己的應用程式（Authorization Callback Domain 填 `localhost`），把 Client ID、Client Secret 填進「設定」

金鑰只存在手機裡（SecureStore），資料也只存在手機裡，沒有雲端。更新時下載新版 APK 覆蓋安裝，資料會保留。

## 開發

```bash
npm install
npx expo start
```

手機安裝 Expo Go，掃終端機上的 QR code。

第一次使用到「設定」：

1. **AI 辨識**：選 Gemini（免費，https://aistudio.google.com 取得金鑰）或 GPT（付費，https://platform.openai.com），貼上金鑰後按「儲存設定」
2. **Strava**（選用）：到 https://www.strava.com/settings/api 建立或使用現有應用程式，Authorization Callback Domain 填 `localhost`，把 Client ID 和 Client Secret 貼到 App 裡按「連結 Strava」（用 Email 登入，App 內網頁不支援 Google 登入）

改完程式跑一下：

```bash
npx tsc --noEmit
npx expo lint
```

## 打包 APK

```bash
npx eas-cli@latest build -p android --profile preview
```

需要免費的 Expo 帳號。完成後下載 APK 裝到手機。

- 版本號由 EAS 管理，每次打包自動加 1
- 之後的新版直接覆蓋安裝，資料會保留；**移除 App 會清掉所有紀錄**
- Expo Go 裡的資料不會帶到 APK
- APK 要用同一個 Expo 帳號打包（簽章金鑰存在 EAS），換帳號就不能覆蓋安裝

## 資料存放

都在手機裡，不上傳雲端：

- 餐點、品項、運動、體重、設定、條碼商品：SQLite `foodlog.db`（結構有變時 App 啟動會自動升級，見 `src/lib/db.ts` 的 `migrateDbIfNeeded`）
- 餐點照片：App 文件資料夾 `photos/`
- API 金鑰、Strava 憑證：Android 加密儲存區（SecureStore）

## 結構

- `src/app/` — 畫面（Expo Router）
  - `(tabs)/` — 今天、歷史、設定
  - `add.tsx` — 新增／編輯餐點
  - `day/[date].tsx` — 某一天的紀錄
  - `strava-connect.tsx` — App 內 Strava 授權頁
- `src/components/` — `DayView`（今天／單日）、`ItemEditor`（品項）、`WeightCard`、`StravaCard`、`BarcodeScanner`、`LabelCard` 等
- `src/lib/db.ts` — SQLite 資料表、遷移、查詢
- `src/lib/recognizer/` — AI 辨識
  - `tasks.ts` — 各種辨識工作（拍餐點、讀營養標示、文字估算）的提示詞、格式、解析
  - `gemini.ts`、`openai.ts` — 兩家 AI 的實作；要加別家就實作 `FoodRecognizer`，在 `src/lib/settings.ts` 的 `getRecognizer` 切換
- `src/lib/products.ts` — 條碼商品（本機記錄、Open Food Facts）
- `src/lib/strava.ts`、`stravaSync.ts` — Strava 授權與同步
- `src/lib/settings.ts` — 每日目標、AI 設定、金鑰
- `src/lib/exercise.ts` — Strava 運動類別、重訓不計熱量的規則
