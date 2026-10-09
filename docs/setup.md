# 会社で共同利用するためのセットアップ

この手順は管理者が検証用Supabaseプロジェクトで実施します。本チャットでは外部サービスを作成・契約していません。

## 1. プロジェクトと認証

1. 会社管理のSupabaseプロジェクトを作成し、料金・保管・バックアップ条件を確認する。
2. Authenticationで公開の新規登録を無効にし、必要な利用者を個別に招待する。共有アカウントにしない。
3. [DBマイグレーション](../supabase/migrations/202610090001_core.sql)を検証用DBへ適用する。この初期マイグレーションを既存業務DBにそのまま繰り返し実行しない。
4. AuthのユーザーUUIDを用いて会社・営業所・membershipsを設定する。

```sql
-- 実際の名前とUUIDに置き換え、DB管理者だけが実行する。
insert into public.organizations(name) values ('会社名') returning id;
insert into public.depots(organization_id, name)
values ('会社UUID', '営業所名') returning id;
insert into public.memberships(user_id, organization_id, depot_id, display_name, role)
values ('AuthユーザーUUID', '会社UUID', '営業所UUID', '運行管理者の氏名', 'manager');
-- driver / dispatcher / admin の所属も同様に設定する。
-- auditor は audit_from / audit_until で閲覧対象の運行作成期間を指定する。
```

ブラウザはmembershipsを書き換えられません。`admin`という理由で指示発行・業務データ閲覧権限は与えません。運行管理者は`manager`として個別に設定します。初期版は一つの営業所につき一人一役割です。管理者の招待画面はまだありません。

## 2. 画面の接続

`.env.example`を`.env`にコピーし、プロジェクトURLと公開用publishable keyを設定します。`npm run build`を再実行してください。実データを含まない`dist/`のみをHTTPSで配信します。privateリポジトリのコード登録は画面配信ではありません。

クラウドモードはSupabase Auth、RLS付き読取、`apply_operation` RPCを使用します。RPCは利用者のJWTから本人を取得し、所属・有効期限・権限・対象運行をDB側で検証します。発行と会社写しと監査イベントは同じトランザクションです。service_roleやsecret keyを画面に設定する必要はありません。

## 3. 本番受入テスト

- 本人・別ドライバー・別営業所・匿名アカウントで読取を確認する。
- ドライバー／配車担当／システム管理者から直接RPCを呼び、発行が拒否されることを確認する。
- 同時更新、二重送信、下書き更新後の発行、旧版確認中の新版発行、圏外復旧を確認する。
- IndexedDBの携行版を保存し、機内モードでPWAを閉じて再起動し、全項目・履歴が読めることを確認する。
- 複数端末の保存通知と、この端末の保存版の違いを確認する。端末故障・ブラウザデータ消去時の代替手順を定める。
- 端末共有は禁止を基本とし、ログアウトで当該アカウントのキャッシュと未送信キューを消去する運用を確認する。未送信データを同期・出力してからログアウトする。
- オフライン中の権限失効は端末へ即時反映できない。端末管理・紛失時の対応を定める。再接続するとサーバーの権限を再検証する。
- JSON/CSV/各版PDF出力を確認し、会社・管轄支局で具体的な帳票と携行方式を確認する。

## 4. バックアップと保存

法定1年と社内方針3年を分けて表示します。実際の勤務終了日（JST）の翌日0時から暦年で保存期限を計算し、終了日の周年日全体を保護します。終了未確定は削除禁止です。初期版に削除APIはなく、監査保留や外国籍ドライバー等の別要件を自動判定しません。

有料契約を含め必要な日次バックアップ・PITR等を設定し、独立した保存先へ運行単位の全版・写し・記録を定期出力します。機密情報をGitHubに保存しません。テスト環境への復元、版数、双方記録、SHA-256、権限の復元を定期検証します。DB管理者による保守操作は別系統のログにも残します。

印刷機能は版の固定計画と出力時点の双方記録から帳票を作ります。現在はPDFファイル自体をサーバーへ固定保管する機能がないため、本番導入前に会社の帳票保管を実装してください。JSONには全版スナップショットと写し・双方記録・監査履歴を含みます。

新しいビルドではオフライン画面キャッシュが更新されます。古いタブを閉じ、オンラインで再起動してから最新版を端末保存してください。

## 参考

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database functions](https://supabase.com/docs/guides/database/functions)
