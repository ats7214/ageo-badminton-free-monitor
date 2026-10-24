# 上尾バドミントン空き通知・無料版

6〜10人、平日18時以降・土日祝全時間。原市・平方・上平・大石・大谷公民館、市民体育館アリーナ半面A/Bを平等に確認します。予約確定はしません。

GitHub公開リポジトリの標準Ubuntu実行環境とntfy.shの無料通知を使用。カード登録・有料サービス・Gmail認証は不要。GitHub定期実行には遅延があります。

通知先と暗号化鍵はGitHub Actions Secretsに保管し、ソースに含めません。通知履歴・観測はAES-256-GCMで暗号化してmonitor-stateブランチへ保存します。

初回配備・本番検証中。定期運転およびiPhone到達確認を完了と称しません。

## 検証

npm ci --ignore-scripts
npm test

実行はnpm start。MONITOR_ENABLEDとCLOUD_BROWSER_APPROVEDがtrueでなければ公式サイトを照会しません。通知先NTFY_TOPIC、暗号化鍵STATE_KEYは秘密設定が必要です。

日付・開始時刻順に通知し、料金は参考表示。公民館は利用4日前、市民体育館は3日前を過ぎるとネット申込期限後の表示とします。部分取得や失敗を空きなしと扱いません。新規・再出現のみ通知し、送信受付後に履歴を残します。

公式：https://www.city.ageo.lg.jp/page/17-shisetuyoyaku.html
無料条件：https://docs.github.com/en/billing/concepts/product-billing/github-actions
通知：https://ntfy.sh/
