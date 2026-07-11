# SPEC.md — 想定仕様書（正準）

> **このファイルの位置づけ**: まっすん（オーナー）の想定仕様の正準ファイル。実装・監査・レビュー・AIエージェントは仕様の解釈をこのファイルと突合する。
> `docs/operations-spec.md` は利用者・運営向けの操作説明（詳細）、本ファイルは「何が意図した仕様か」の正準宣言という役割分担。
>
> **各項目のステータス**:
> - ✅ **確認済み** — まっすんが「想定どおり」と確認した正準仕様
> - 🔺 **想定と実装が不一致** — まっすん確認済み。本文に**想定仕様**を記載し、現状の実装挙動は注記。修正タスクを TASKS.md に起票済み
> - ❓ **要確認** — 意図した仕様か実装の偶然か曖昧なもの（確認ポイントつき）。まっすんの回答待ち
> - ⬜ **未確認** — 実装の現在の挙動の書き起こし（仕様候補）。まっすんの確認をもって ✅ になる
>
> **運用ルール**:
> - まっすんが確認したら ⬜/❓ を「✅ 確認済み（日付）」に書き換える
> - 「想定と違う」項目は、本ファイルを**想定仕様**に書き換え（現在の実装挙動は注記として残す）、TASKS.md に修正タスクを起票する
> - 実装を変更したら対応する項目と根拠行を更新する（living doc）
> - 「根拠」は抽出時点（2026-07-02）のファイル:行。コード変更でずれることがある
> - 同じ仕様が別の章に別視点で載ることがある（例: 自動再開は EVT / JOIN / ADM に登場）。矛盾を見つけたらそれ自体が要修正
>
> 作成: 2026-07-02 — 実装コードから7領域×（抽出→敵対的検証）の14エージェントで抽出した全136項目

## 1. 会員登録・ログイン・メール確認

### AUTH-01 — ⬜ 未確認

新規登録の入力必須項目は姓・名・メールアドレス・パスワード（6文字以上）。ニックネームは任意入力。姓または名が空（前後の空白を除去した結果が空文字）の場合は「姓と名を入力してください」、パスワードが6文字未満の場合は「パスワードは6文字以上にしてください」とエラー表示され送信されない。

- 根拠: `app/login/page.tsx:99-110`

### AUTH-02 — ⬜ 未確認

表示名は「姓 名(ニックネーム)」の形式で組み立てられる。ニックネームが未入力（トリム後に空文字）の場合は「姓 名」のみで、括弧は付かない。姓・名・ニックネームはそれぞれ前後の空白を除去してから結合される。

- 根拠: `app/login/page.tsx:99-101,112`

### AUTH-03 — ⬜ 未確認

新規登録すると、入力したメールアドレス宛に6桁の確認コードが送信され、「確認コードを送信しました。メールが届いたら『コード入力へ進む』から登録を完了してください。届かない場合は、1時間ほど空けてからもう一度送信してください。」という案内が表示される。この時点ではまだ members 行は作成されない。

- 根拠: `app/login/page.tsx:154-159`

### AUTH-04 — ⬜ 未確認

確認コード入力欄は数字以外の文字を自動的に除去し、最大6桁までしか入力できない。トリム後の値が6桁の数字でない場合は「6桁の確認コードを入力してください」と表示され送信されない。

- 根拠: `app/login/page.tsx:164-168,236-243`

### AUTH-05 — ❓ 要確認

確認コードを検証する際、まず type='signup' で検証し、失敗した場合は type='email' で再検証する。いずれも失敗、またはセッション取得に失敗した場合は「確認コードが正しくないか、有効期限が切れています」と表示される（コードの誤り・期限切れ・その他のエラーが同一文言で表示され区別されない）。

- 根拠: `app/login/page.tsx:173-192`
- ❓ 確認ポイント: type='signup'失敗時にtype='email'で自動リトライする実装意図（Confirm email設定変更等の過去の互換対応の可能性）が不明瞭。また誤入力・期限切れ・システムエラーが同一エラー文言になり、利用者が原因を区別できない点も意図した仕様か確認が必要。

### AUTH-06 — ❓ 要確認

確認コードのメール確認完了後、会員登録APIを呼び出して会員情報（members行）を作成し、成功するとトップページへ遷移する。会員登録APIが失敗した場合は「会員情報の登録に失敗しました」と表示され、認証（Supabaseユーザー）自体は作成済みのまま残る。

- 根拠: `app/login/page.tsx:194-201`
- ❓ 確認ポイント: 会員登録APIが失敗した場合、Supabase認証ユーザーは作成済み・確認済みのまま members 行だけが欠けた状態になる。この状態からの復帰手段（再ログインでensureMemberが再実行されるか等）が明示されておらず、運用上のトラブル時にオーナーへの説明が必要になりうる。

### AUTH-07 — ❓ 要確認

確認コード入力画面を離れて放置しても、登録処理そのものは中断されない。「コード入力へ進む」ボタンを再度押せば同じ画面に戻れるが、ブラウザをリロードするとpendingRegistration（対象メールアドレス・表示名）はメモリ上のReact stateのため失われ、登録し直す必要がある。

- 根拠: `app/login/page.tsx:47-51,307-320`
- ❓ 確認ポイント: 画面リロードや別タブでの再訪問時にコード入力状態が保持されない実装（React stateのみで永続化なし）。ドキュメント（docs/operations-spec.md:69）は「放置するとコードが無効になる」とのみ説明しており、リロードで即座に入力画面へ戻れなくなる点は明記されていない。

### AUTH-08 — ⬜ 未確認

ログイン失敗時、Supabaseから返るエラーメッセージに「Email not confirmed」が含まれる場合は「メール確認が完了していません。新規登録タブから同じメールアドレスとパスワードで再登録すると、確認コードを再送できます」と案内される。それ以外の失敗（メールアドレス誤り・パスワード誤り・アカウント不存在等）は原因を区別せず一律「メールアドレスまたはパスワードが違います」と表示される。

- 根拠: `app/login/page.tsx:76-80`

### AUTH-09 — ⬜ 未確認

確認済み（メール確認完了済み）の既存メールアドレスで新規登録を試みると、Supabaseはエラーもセッションも返さず、identitiesが空の user のみを返す（新たな確認メールは送信されない）。この場合「このメールアドレスは登録済みです。ログインタブからお進みください」と表示される。

- 根拠: `app/login/page.tsx:146-152`

### AUTH-10 — ❓ 要確認

メール確認コードの送信に失敗した場合のエラー文言は原因により3パターンに分岐する。(1) 送信上限到達（rate limit系。エラーコードover_email_send_rate_limit・HTTPステータス429・メッセージに'rate limit'/'email rate'/'sending confirmation email'を含む場合）は「現在、確認メールの送信上限に達しています。お手数ですが、1時間ほど空けてからもう一度登録してください。」、(2) メッセージに'email'を含むその他のエラーは「確認メールの送信に失敗しました。メールアドレスを確認し、時間を空けてからもう一度登録してください。」、(3) それ以外はSupabaseから返された元のエラーメッセージ（またはエラーオブジェクト自体が未取得の場合は「登録に失敗しました。確認メールが届かない場合は、1時間ほど空けてからもう一度登録してください。」）がそのまま表示される。

- 根拠: `app/login/page.tsx:25-43`
- ❓ 確認ポイント: 分岐(3)ではSupabaseの生のエラーメッセージ（英語の場合がある）がそのまま利用者に表示される可能性があり、日本語UIとして適切かオーナー確認が必要。

### AUTH-11 — ⬜ 未確認

ログイン成功後、Supabaseセッションのアクセストークンとユーザーが取得できた場合のみ会員登録API（ensureMember）を呼び出す。渡す表示名はuser_metadata.display_nameがあればそれを、なければメールアドレスのローカル部分（@より前）を使う。会員情報の取得（登録）に失敗した場合は「会員情報の取得に失敗しました。時間をおいて再度ログインしてください」と表示され、トップページには遷移しない。

- 根拠: `app/login/page.tsx:82-96`

### AUTH-12 — ✅ 確認済み（2026-07-03 まっすん確認・当面この仕様で運用）

会員登録RPC（register_member）は同一auth_user_idで既に会員が存在する場合、名前を更新せず（登録時に渡した名前は無視され）、最終アクセス日時（last_accessed_at）のみを現在時刻に更新した既存会員情報を返す。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:69-76`
- 確認結果: 当面この仕様で運用（MEM-03 と同一仕様の登録視点）。姓名変更機能の追加は検討中（TASKS.md 起票済み）。

### AUTH-13 — ⬜ 未確認

会員番号は3桁ゼロ埋め（例: 001, 002）で、登録時点で使われていない最小の番号が自動採番される。番号の重複を避けるためアドバイザリロックで排他制御されるが、それでも一意制約違反（unique_violation）が発生した場合はRPCが「member registration conflicted」（status 409相当の情報）をエラーとして返す。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:78-107`

### AUTH-14 — ⬜ 未確認

会員登録API（/api/members POST）は name が空文字（トリム後）または auth_user_id が未指定・非文字列の場合「name と auth_user_id は必須です」（400）を返す。name が100文字を超える場合は「name は 100 文字以内で入力してください」（400）を返す。

- 根拠: `app/api/members/route.ts:22-36`

### AUTH-15 — ⬜ 未確認

会員登録APIはBearerトークンで認証したユーザーIDとリクエストボディのauth_user_idが一致しない場合「本人確認に失敗しました」（403）を返し登録を拒否する。未認証（トークンなし・無効）の場合は「ログインが必要です」（401）を返す。

- 根拠: `app/api/members/route.ts:38-44`

### AUTH-16 — ⬜ 未確認

register_member RPCが未適用（マイグレーション未反映、エラーコードPGRST202または'register_member'を含むエラー）の環境では、会員登録APIは「会員登録RPCが未適用です」（500）を返す。auth_user_idが外部キー制約違反（エラーコード23503、存在しないauth.usersを参照）の場合は「auth_user_id が正しくありません」（400）を返す。

- 根拠: `app/api/members/route.ts:51-58`

### AUTH-17 — ⬜ 未確認

メール内リンク（token_hash・type付きURL）経由での確認完了時は/auth/callbackページで自動的にOTP検証・会員登録・トップページへのリダイレクト（router.replace）が行われる。token_hashが無い場合は既存セッションの取得のみを試みる。検証やセッション取得、会員登録のいずれかに失敗した場合は「メール確認に失敗しました。ログイン画面からもう一度お試しください。」と表示され、2.5秒後にログイン画面へ自動遷移する。

- 根拠: `app/auth/callback/page.tsx:49-85`

### AUTH-18 — ❓ 要確認

確認メール送信のOTP有効期限は3600秒（1時間）、コード長は6桁、送信レート制限は最短1秒間隔（max_frequency）。ただしこれらはローカル開発用のsupabase/config.toml設定値であり、本番環境の実際の値はSupabaseダッシュボード側の設定が正となる。

- 根拠: `supabase/config.toml:56,58-60`
- ❓ 確認ポイント: config.toml内のコメント（51-55行）自体が「本番のConfirm email設定はSupabaseダッシュボードが正であり、config.tomlはローカルCLI専用」と明記しており、本番のOTP有効期限・送信頻度制限が実際にこの値と一致しているか運用側での確認が必要。

### AUTH-19 — ⬜ 未確認

Supabase無料枠では確認メールの送信は1時間あたり最大2通に制限されており、これはアプリコードでは制御されていない外部（Supabase側）の制約である。短時間に複数回登録テストを行うと送信上限エラーになる。

- 根拠: `docs/operations-spec.md:69,73,303; docs/EMAIL_SWITCHOVER_RUNBOOK.md:3`

## 2. イベントのライフサイクル

### EVT-01 — ⬜ 未確認

イベント新規作成時のデフォルトステータスは「受付中（accepting）」。ただし作成リクエストで status を明示的に draft / closed / archived のいずれかに指定して作成することもできる（EVENT_STATUSES に含まれる4値なら許容される）。

- 根拠: `app/api/admin/events/route.ts:9,90,113-115,150`

### EVT-02 — ⬜ 未確認

下書き（draft）イベントに公開予約日時（publishes_at）を設定すると、その日時を過ぎた時点で status が自動的に「受付中（accepting）」へ昇格し、同時に is_manual_close が false にリセットされる。publishes_at が未設定（null）の下書きは自動昇格しない。

- 根拠: `lib/event-publishing.ts:3-12, supabase/migrations/20260614031000_schedule_due_draft_promotion.sql:1-13`

### EVT-03 — ⬜ 未確認

下書き→受付中の自動昇格処理は二重の仕組みで実行される。(1) Supabase の pg_cron が毎分 public.publish_due_draft_events() を実行、(2) 管理者/参加者向けの主要APIリクエスト（管理者イベント一覧取得・参加者一覧取得・参加登録・キャンセル・トップページ表示・イベント詳細ページ表示）のたびにアプリ側でも同じ昇格処理（publishDueDraftEvents）が呼ばれる。

- 根拠: `app/api/admin/events/route.ts:159-165, app/api/participants/route.ts:27,86, app/api/cancel/route.ts:42, app/page.tsx:14, app/events/[id]/page.tsx:19, supabase/migrations/20260614031000_schedule_due_draft_promotion.sql:27-31`

### EVT-04 — ❓ 要確認

publishes_at を経由しない自動昇格の専用エンドポイント /api/cron/publish-drafts は実装されているが、vercel.json の cron スケジュールには登録されておらず（crons配列には /api/cron/cleanup のみが存在）、Vercel Cron からは定期実行されない。docs/cron-environment.md 自身が『認証付きの手動フォールバックとして残しているだけで vercel.json からはスケジュールしていない』と明記しており、実運用上の昇格処理は pg_cron の毎分ジョブとアプリ側の各リクエスト時呼び出しに委ねられている。

- 根拠: `app/api/cron/publish-drafts/route.ts:1-27, vercel.json:1-7, docs/cron-environment.md:22-29`
- ❓ 確認ポイント: コードとドキュメント（docs/cron-environment.md）は完全に一致しており矛盾はない。念のため、将来的に /api/cron/publish-drafts を vercel.json に登録して二重化する計画があるか、それとも現状（未スケジュールの手動フォールバックのまま）を意図した最終形とするか、オーナーの認識を確認したい。

### EVT-05 — ⬜ 未確認

参加登録時、まずイベントの status が accepting でなければ「現在は参加申請を受け付けていません」で拒否される（status チェックが定員チェックより先）。status が accepting で、かつ有効参加者数（active）が定員（max_participants）に既に達している状態で参加申請が来ると、その場でイベントを status='closed' へ自動更新してから「定員に達したため締め切りました」というエラーを返す（自動締切1: 満員到達を検知したタイミング）。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:70-86`

### EVT-06 — ⬜ 未確認

参加登録によって有効参加者数（active）が定員（max_participants）ちょうどに到達した場合も、登録処理の最後に status='closed' へ自動更新する（自動締切2: 定員ちょうど埋まった瞬間の締切）。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:109-113`

### EVT-07 — ⬜ 未確認

日付・時刻経過による自動締切は存在しない。締切（closed）に至るのは「定員到達による自動締切」と「管理者による手動締切」の2パターンのみ。旧仕様にあった closes_at（申込締切日時）による自動締切機能は撤去済みで、既存イベントの closes_at 値も一括で null 化された。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:1-6, docs/operations-spec.md:176,294`

### EVT-08 — ✅ 確認済み（2026-07-03 まっすん確認）

参加者が active 枠からキャンセルし、かつイベントが draft ではなく、かつ is_manual_close が false（＝手動締切ではない）の場合に限り、自動再開の判定に入る。判定条件は「キャンセル後の有効参加者数が定員未満」かつ「現在ステータスが closed」かつ「キャンセル後の有効参加者数が閾値（threshold）未満」かつ「キャンセル前の有効参加者数が閾値以上」の4条件すべてを満たすこと。満たす場合、status を accepting に戻し、同時に max_participants を threshold の値へ更新（定員を引き下げる）する。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:239-251`
- 関連: EVT-18 / JOIN-10 / ADM-22（同一仕様の別視点。運用イメージ: 初回募集35人 → 満員締切 → 29人以下で再開 → 以降は30人が上限）

### EVT-09 — ⬜ 未確認

管理者が管理画面から手動でステータスを「締切（closed）」に切り替えると is_manual_close が true に設定される。手動締切されたイベントは、参加者がキャンセルして参加者数が閾値を下回っても自動再開しない。

- 根拠: `app/api/admin/events/route.ts:328-334, supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:239 (is_manual_close チェック)`

### EVT-10 — ⬜ 未確認

管理者が管理画面からステータスを closed 以外（accepting・draft・archived のいずれか）に手動変更すると、is_manual_close は自動的に false へリセットされる。

- 根拠: `app/api/admin/events/route.ts:328-334`

### EVT-11 — ❓ 要確認

管理者向けPATCH API自体はイベントのステータスを accepting・closed・draft・archived の4値のいずれにも自由に変更できる（archived への変更や archived からの変更も値としてはAPI上拒否されない）。ただし管理画面UIの状態切替ボタン（handleToggleStatus）は draft→accepting、accepting→closed、closed→accepting の3パターンのみを発行し、event.status が archived の場合は早期リターンして何もしない。つまりUI操作からは archived への手動移行も archived からの手動復帰もできず、そのAPI許容範囲はUIでは導線化されていない。

- 根拠: `app/api/admin/events/route.ts:9,279-281,330-336, app/admin/events/[id]/page.tsx:90-98`
- ❓ 確認ポイント: 運営ドキュメント（docs/operations-spec.md）は『下書き→公開、受付中→締切、締切→受付中』のトグル操作のみを想定した説明になっており、実際のUIコンポーネントもarchived状態のイベントに対しては操作ボタンを無効化(早期return)している。API単体としてはarchivedへの手動切替が可能な状態が『意図した安全策（UIで隠すことで誤操作を防ぐ）』か、それとも『本来APIでも拒否すべきだが未実装』かをオーナーに確認したい。

### EVT-12 — ⬜ 未確認

毎日1回（15:00 UTC = 日本時間0:00）実行されるVercel Cronジョブが、終了日時（event_end_date）を過ぎ、かつステータスが accepting または closed のイベントを検出し、status を archived に一括更新する（is_manual_close も同時に false へリセット）。draft や既に archived のイベントはこの処理の対象外。

- 根拠: `app/api/cron/cleanup/route.ts:14,34-58, vercel.json:1-7`

### EVT-13 — ⬜ 未確認

アーカイブ済み（archived）イベントは物理削除されず、データベース上に保持される。参加者名・参加履歴もそのまま残る。

- 根拠: `app/api/cron/cleanup/route.ts:16,35-40, docs/operations-spec.md:114`

### EVT-14 — ⬜ 未確認

アーカイブ済みイベントは一般参加者向けの画面・APIから見えなくなる。参加者向けの events テーブルSELECT権限はRLSで status in ('accepting','closed') に限定されており、draft・archived は参加者からは原理上参照不可能。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:20-24, lib/event-visibility.ts:8-9`

### EVT-15 — ⬜ 未確認

参加者公開ビュー（participants_public）も events.status が accepting または closed のイベントの参加者のみを返す。イベントが archived や draft になった時点で、そのイベントの参加者一覧も参加者側からは見えなくなる。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:26-41`

### EVT-16 — ⬜ 未確認

管理者は管理画面で「アーカイブ済み一覧」に切り替えることで、アーカイブ済みイベントとその参加者一覧を閲覧できる。管理者向けAPIには status=archived のみを絞り込むクエリパラメータ（archived=1）と、archived を除外する通常ビュー、両者をまとめて返すgrouped=1の3種類の取得方法がある。

- 根拠: `app/api/admin/events/route.ts:196-225`

### EVT-17 — ⬜ 未確認

イベントを新規作成する際、定員上限（max_participants）の初期値は35人、再開閾値（threshold）の初期値は30人。作成・更新いずれの操作でも「閾値が定員を超えている」場合はエラーとして拒否され、閾値は必ず定員以下でなければならない。

- 根拠: `app/api/admin/events/route.ts:90-91,68-71,317-323`

### EVT-18 — ✅ 確認済み（2026-07-03 まっすん確認）

自動再開が発生すると、定員上限（max_participants）が再開閾値（threshold）の値に置き換わる（定員が引き下げられる）。これにより自動再開後は threshold の値が事実上の新しい定員上限として扱われ、以降さらにキャンセルが増えても threshold 未満に落ちることはあっても、定員はそれ以上動かない。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:246-249`

### EVT-19 — ⬜ 未確認

イベントの status が accepting でない状態（draft・closed・archived）での参加登録は、たとえ空き枠があっても「現在は参加申請を受け付けていません」のエラーで拒否される。定員判定の前に必ず status チェックが行われる。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:70-75`

### EVT-20 — ✅ 確認済み（2026-07-03 まっすん確認）

イベント削除（管理画面からのDELETE操作）は物理削除であり、そのイベントに紐づく参加者データもすべて連動して削除される（DB外部キーのON DELETE CASCADEに依存）。draft・accepting・closed・archived のいずれの状態のイベントに対しても実行制限なく呼び出せ、アーカイブ化（status=archived）とは異なり、削除すると参加履歴は復元不可能になる。

- 根拠: `app/api/admin/events/route.ts:227-250, docs/operations-spec.md:281`
- 確認結果: 想定どおり。削除したイベントは情報が何も残らない方がよい、という意図。誤操作の守りは確認ダイアログのみで許容。

## 3. 参加・キャンセル・定員

### JOIN-01 — ⬜ 未確認

参加申込・友達追加（いずれもPOST /api/participants）はログイン会員のみ可能。未ログイン（AuthorizationヘッダにBearerトークンなし）の場合は401「ログインが必要です」で拒否される。

- 根拠: `app/api/participants/route.ts:129-134, lib/api-auth.ts:88-91`

### JOIN-02 — ⬜ 未確認

1会員が同一イベントに本人として参加できるのは1件のみ。既にactiveまたはwaitlist（cancelled以外）で登録済みの場合はjoin_event RPCが409「すでにこのイベントに登録済みです」を返す（cancelled状態は対象外で再申込可）。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:45-61`

### JOIN-03 — ⬜ 未確認

友達（ゲスト）は1人が追加できる人数の固定上限がなく、その時点のイベント空き枠数（定員−現在のactive参加者数）まで追加できる。過去に1イベント3名までの上限が実装されていた時期があるが（20260527010000_allow_guest_invites_until_capacity.sql:41-49「v_guest_count >= 3」チェック）、後続migration（20260602040000_join_event_unique_violation_guard.sql、以降20260620010000まで）で当該チェックが削除され撤廃済み。現行実装・docs/operations-spec.mdともに上限なしで一致している。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:31-33,45-113（ゲスト人数チェックなし）, supabase/migrations/20260527010000_allow_guest_invites_until_capacity.sql:41-49（3名制限ロジックがこの版には存在）, docs/operations-spec.md:222-223`

### JOIN-04 — ✅ 確認済み（2026-07-03 まっすん確認）

定員到達時（active人数が定員に達している）は待機リスト（waitlist）扱いにならず、参加申込自体がjoin_event RPCから409「定員に達したため締め切りました。参加枠が閾値未満になるまで追加申請できません」で拒否され、同時にイベントステータスがclosedへ自動遷移する。ParticipantStatus型にはwaitlist値が定義され、cancel_participant側もwaitlistを扱えるが、join_event側にwaitlistへ振り分ける経路が存在しない（常時上限到達＝即エラー）。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:77-86, lib/supabase.ts:4（ParticipantStatus型にwaitlistが定義されているが到達経路なし）`
- 確認結果: 「満員＝即拒否、待機リストなし」が想定どおり。waitlist はコード上の未使用パス（整理は TASKS.md の整理課題扱い）。

### JOIN-05 — ⬜ 未確認

定員はイベントごとの数値（デフォルト35名、eventsテーブルmax_participantsカラム）で、参加登録時のslot_numberは「現在のactive人数+1」で採番される。採番したslot_numberが定員以上になった時点（つまり定員ちょうどに達した申込）で、そのイベントは自動的にclosed（締切済み）へ遷移する。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:64-68,88,109-113, supabase/migrations/20260527020000_close_full_events_without_waitlist.sql:1-2（max_participants デフォルト35）`

### JOIN-06 — ⬜ 未確認

参加受付中（status='accepting'）でなければ参加申込はjoin_event RPCから409「現在は参加申請を受け付けていません」で拒否される。draft・closed・archivedいずれの状態でも申込不可。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:70-75`

### JOIN-07 — ⬜ 未確認

キャンセルできるのは、本人（自分のparticipant行）、自分が追加した友達（user_codeが`guest:{自分のmember_id}:`で始まる行）、管理者（Cookieベースの管理者セッション）、または旧方式の一時コード保持者（member_idがnullかつguest行でない参加者が、user_codeと完全一致するコードを提示した場合）のいずれか。それ以外は401「ログインが必要です」または403「本人確認に失敗しました」で拒否される。

- 根拠: `app/api/cancel/route.ts:60-86`

### JOIN-08 — ⬜ 未確認

キャンセル対象がすでにcancelled状態の場合は400「すでにキャンセル済みです」で拒否される（active・waitlist以外はキャンセル不可）。この判定はAPI側（cancel/route.ts）とcancel_participant RPC側の両方で行われる。

- 根拠: `app/api/cancel/route.ts:88-90, supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:177-179`

### JOIN-09 — ⬜ 未確認

キャンセルすると同一イベントの残り参加者（active・waitlist）のslot_numberが繰り上げ再計算される（activeを先、waitlistを後、その中では元のslot_number→created_at→id順）。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:195-231`

### JOIN-10 — ✅ 確認済み（2026-07-03 まっすん確認）

満員で自動締切後、キャンセルでactive人数がイベントごとのthreshold値（eventsテーブルthresholdカラム、デフォルト30人）を下回ると自動的にaccepting状態へ再開し、以降はmax_participantsがthreshold値と同値に更新される。手動締切（is_manual_close=true）の場合は自動再開しない。draft状態のイベントも自動再開の対象外。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:239-253, supabase/migrations/20260526020000_add_is_manual_close.sql:1-6, supabase/migrations/20260525000000_baseline_schema.sql:26（threshold デフォルト30）`

### JOIN-11 — ⬜ 未確認

同時申込（複数人が同時にAPIを叩く）は、イベント行に対するFOR UPDATE行ロックで直列化されるため、定員超過の同時挿入は発生しない。万一slot_numberのユニーク制約（event_id, slot_number、active/waitlist時のみの部分ユニークインデックス）に違反した場合も、生のPostgresエラーをそのまま返さず409「席の確保に失敗しました。もう一度お試しください」に変換される。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:35-39,90-107, supabase/migrations/20260602050000_participants_slot_unique_index.sql:34-36`

### JOIN-12 — ⬜ 未確認

参加者名（本人・友達とも）は必須で、100文字を超えると400「name は 100 文字以内で入力してください」で拒否される。友達名は空欄不可（クライアント側で「友達の名前を入力してください」を表示）。

- 根拠: `app/api/participants/route.ts:139-147, components/JoinForm.tsx:318-322`

### JOIN-13 — ⬜ 未確認

友達追加時の表示名は自動的に「入力名(紹介者の姓の友達)」の形式に整形される（姓は紹介者の会員名から括弧書き部分を除いた先頭の空白区切りトークン）。この整形はサーバ側ではなくクライアント側（JoinForm）で行われ、そのままAPIへ送信される。

- 根拠: `components/JoinForm.tsx:55-58,339`

### JOIN-14 — ❓ 要確認

友達（ゲスト）参加者には「臨時ID」として5桁の数値コード（10000〜99999、ランダム生成）が発行され、キャンセル時の本人以外の識別手段として使われる。docs記載の「臨時ID: XXXXXX」という6文字表記例は実装の5桁と桁数が食い違っている。

- 根拠: `lib/supabase.ts:54-56, app/api/participants/route.ts:164-165, docs/operations-spec.md:132`
- ❓ 確認ポイント: docsの「臨時ID: XXXXXX」というプレースホルダ表記（6文字）と実装の5桁数値コードが字面上一致しない。表記揺れなのか、将来6桁化する予定があったのか確認したい。実務影響は小さいが仕様書の数値を正確にするため確認事項とする。

### JOIN-15 — 🔺 想定と実装が不一致（2026-07-03 まっすん確認・修正待ち）

参加者一覧取得API（event_idのみ指定・member_id省略）は、そのイベントに参加登録された全員のdisplay_code（友達の臨時ID）を、閲覧者が誰であるかに関わらず返す（participants_publicビューはauthenticatedロール全体にgrant selectされている）。つまり自分が追加していない他人の友達の臨時IDも、ログインしていれば一覧画面から閲覧できる。

- 根拠: `app/api/participants/route.ts:61-69, supabase/migrations/20260619010000_member_retention_and_archives.sql:26-45`
- **想定仕様**: 参加者一覧に友達の臨時ID（display_code）を**表示しない**。友達の識別は「◯◯の友達」という名前表記で足りる。なお会員本人のID・コードは現状も一覧に出ない（display_code は guest: 形式の行のみ表示され、会員行は null）。表示廃止の実装時は、自分の友達欄の表示（`components/JoinForm.tsx:52`）等の用途を調査のうえ実施。修正タスクを TASKS.md に起票済み（2026-07-03）。

### JOIN-16 — ⬜ 未確認

参加者一覧・自分の参加状況は、イベントがaccepting（受付中）またはclosed（締切済み）の場合のみ閲覧可能。draft（下書き）・archived（アーカイブ済み）のイベントは会員から見えず、参加/キャンセルAPIも404「イベントが見つかりません」を返す。

- 根拠: `lib/event-visibility.ts:8-10, app/api/participants/route.ts:36,108-109,154-155`

### JOIN-17 — ⬜ 未確認

締切済み（closed）のイベントでも、既存参加者はキャンセルが可能（キャンセルAPIは受付中/締切済み両方のイベントで動作し、参加申込のみaccepting限定）。

- 根拠: `app/api/cancel/route.ts:65-67（isVisibleToMembers=accepting or closedのみで拒否）, app/api/cancel/route.ts:88-90（statusチェックのみで event.status='accepting' の制約なし）`

### JOIN-18 — ⬜ 未確認

会員が他人のmember_idを指定して参加状況を照会・参加申込しようとすると403「本人確認に失敗しました」で拒否される（member_idはBearerトークンで認証された本人のIDと一致必須）。

- 根拠: `lib/api-auth.ts:111-113`

### JOIN-19 — ⬜ 未確認

クライアント画面（JoinForm）は、締切済み状態でのキャンセル確認ダイアログにおいて、自分がキャンセルした後の想定active人数がイベントのthreshold値以上のままなら通常の確認文言、threshold値を下回る場合は「参加者数がN人を下回るまで追加の参加申請はできません」という警告文言を出し分ける（Nはそのイベントのthreshold値、デフォルト30）。この閾値表示はUI上の事前案内であり、実際の再開判定はサーバ側RPCで独立に行われる。

- 根拠: `components/JoinForm.tsx:203-211`

### JOIN-20 — ⬜ 未確認

join_event・cancel_participant のPostgres関数はanon/authenticatedロールへの直接実行権限がなく、service_role（Next.js APIサーバー経由）からのみ実行できる。クライアントSDKから直接RPCを呼び出すことはRLS/権限設定上ブロックされている。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:122-124,264-266`

### JOIN-21 — ⬜ 未確認

イベントの締切日時（closes_at）による自動締切機能は撤廃済み。既存イベントのcloses_atは一律nullへ更新され、join_event関数からもcloses_atチェックのロジックが削除されている。締切は「定員到達」または「運営による手動締切（is_manual_close）」のみで発生する。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:4-6,70-75（20260602050000版に存在したcloses_atチェックがこの版では削除されている）`

### JOIN-22 — ❓ 要確認

本人の参加登録がactive/waitlistの会員には、イベント詳細ページにGoogleカレンダー追加リンクと.icsカレンダー追加リンクが表示される（友達招待のみで本人不参加の場合は表示されない）。Googleリンクはrenderテンプレート方式でOAuth不要。両リンクとも日時はUTC(Z形式)で生成し、event_end_dateがnullの場合は開始+2時間を終了時刻としてフォールバックする。

- 根拠: `lib/calendar-event.ts, components/CalendarLinks.tsx, components/JoinForm.tsx`
- ❓ 確認ポイント: event_end_dateがnullの場合の「開始+2時間」というフォールバック値は実装時の暫定仮定であり、実際の練習時間の相場に基づいた値ではない。まっすんの確認・妥当性判断が必要。

### JOIN-23 — ❓ 要確認

.icsダウンロードAPI（GET /api/events/[id]/ics）はログイン不要で取得できる。イベント詳細ページと同じisVisibleToMembers判定（status=accepting/closedのみ）を適用し、draft/archived/存在しないイベントIDには404を返す。参加者個人情報は含まれず、イベントの公開情報（タイトル・日時・場所）のみICS化する。レスポンスはContent-Disposition: inline・Content-Type method=PUBLISH・ics本文にMETHOD:PUBLISHを付与している（2026-07-11: iPhone実機でattachment設定だとタップしても無反応だったため修正）。

- 根拠: `app/api/events/[id]/ics/route.ts, lib/event-visibility.ts, lib/ics.ts`
- ❓ 確認ポイント: inline + method=PUBLISHへの変更で実機（iPhone Safari）のカレンダー追加プロンプトが正しく開くか、まっすんの再確認が必要。改善しない場合はContent-Dispositionヘッダー自体の削除等、追加の調整を検討する。

### JOIN-24 — ⬜ 未確認

Google/.icsどちらの方式も追加時点の情報をコピーする片方向連携であり、本サイト側から追加済みの予定を削除・更新する機能は実装されていない。日程変更・キャンセルが発生しても既にカレンダーに追加済みの予定は自動追従しない。UI上に手動削除・修正を促す注意文言を必須表示する。

- 根拠: `lib/ics.ts（SEQUENCE固定・UID安定生成）, components/CalendarLinks.tsx（注意文言）`

## 4. 会員管理

### MEM-01 — ⬜ 未確認

会員番号は最小の空き番号を3桁ゼロ埋め形式（例: 001, 002, 003）で自動付番される。register_member RPC内で既存の会員番号（正規表現 ^[0-9]+$ にマッチし0より大きい数値文字列）から欠番を探し、欠番がなければ現在の最大番号+1を採番する。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:79-96`

### MEM-02 — ⬜ 未確認

休眠会員の削除で空いた会員番号は、次の新規登録者に再利用される（最小空き番号ロジックにより自動的に埋まる）。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:79-96, app/api/cron/cleanup/route.ts:96-100`

### MEM-03 — ✅ 確認済み（2026-07-03 まっすん確認・当面この仕様で運用）

会員登録RPC（register_member）は、渡された auth_user_id が既存会員に紐づく場合は新規会員を作らず、既存会員の last_accessed_at を現在時刻に更新して返す（名前は更新しない）。auth_user_id が未登録の場合のみ新規会員として採番・作成する。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:64-74`
- 確認結果: 当面この仕様（2回目以降の登録・ログインでは名前を更新しない）で運用。ただし結婚による改姓等を想定し、ニックネームだけでなく**姓名も変更可能にするか検討中**（現状の変更手段はヘッダーのニックネーム変更のみ）。検討タスクを TASKS.md に起票済み。関連: AUTH-12 / MEM-05。

### MEM-04 — ⬜ 未確認

会員の表示名は「姓 名(ニックネーム)」形式の単一文字列として members.name に保存される。ニックネームが空の場合は「姓 名」のみで括弧は付かない。新規登録画面（姓・名・ニックネームの3項目入力）で組み立てられた文字列がそのまま初回登録名になる。

- 根拠: `app/login/page.tsx:98-113, components/MemberHeader.tsx:13-21`

### MEM-05 — ⬜ 未確認

ヘッダーの「ニックネーム変更」機能は、既存の表示名を正規表現 ^(.*?)(?:\(([^()]*)\))?$ で「姓名部分」と「ニックネーム部分」に分解し、ニックネームのみを差し替えて再結合した文字列で update_member_name RPC（PATCH /api/members）を呼ぶ。姓・名そのものを変更するUIは存在しない。

- 根拠: `components/MemberHeader.tsx:13-21, 61-84, docs/operations-spec.md:90`

### MEM-06 — ⬜ 未確認

会員名（表示名）を変更すると、その会員が現在「参加中（active）」または「キャンセル待ち（waitlist）」になっている参加者レコードの名前も同時に更新される。既に「キャンセル済み（cancelled）」の参加履歴の名前は更新されない。

- 根拠: `supabase/migrations/20260602070000_update_member_name_rpc.sql:29-33`

### MEM-07 — ⬜ 未確認

会員が本人の参加登録とは別に追加した「友達」参加者の表示名（『友達名(◯◯の友達)』の◯◯部分）は、追加した時点の会員の姓（表示名からニックネーム括弧を除き、スペース区切りの最初の語）で固定される。会員が後からニックネームや表示名を変更しても、既存の友達エントリの◯◯部分は追従しない。

- 根拠: `components/JoinForm.tsx:55-58, 339, docs/operations-spec.md:302`

### MEM-08 — ✅ 確認済み（2026-07-03 まっすん確認・現状維持）

members.last_accessed_at は、サーバーコンポーネントでCookieセッションから会員を解決する処理（トップページ・イベント詳細ページの初回描画。getCookieMember）が呼ばれた際に更新されるが、前回更新から24時間（86,400,000ミリ秒）未満であれば更新をスキップする間引き処理になっている。

- 根拠: `lib/server-member.ts:6-18, 48-56, app/page.tsx:29, app/events/[id]/page.tsx:76`
- 確認結果: 毎アクセス更新が望ましいが、24時間間引きは DB 書き込み削減のための合理的な実装であり、休眠判定（365日）へのずれは最大24時間＝実質影響ゼロのため**現状維持**。docs/operations-spec.md の「アクセスのたびに更新」という記述を実装に合わせて修正する（TASKS.md 起票済み）。関連: CRON-16。

### MEM-09 — ⬜ 未確認

365日（DORMANT_MEMBER_DAYS=365）以上 last_accessed_at が更新されていない会員は、毎日実行されるcronジョブ（Vercel Cron、15:00 UTC = 00:00 JST）により自動削除される。1回のcron実行で処理する休眠会員は最大100件（CLEANUP_BATCH_SIZE）。

- 根拠: `app/api/cron/cleanup/route.ts:5-6, 14, 67-72`

### MEM-10 — ⬜ 未確認

休眠会員を削除する際、その会員が紐づいていた参加履歴（participants）は削除されず、member_id のみ null に更新されて残る。参加者名（participants.name）は削除時点の値のまま保持される。

- 根拠: `app/api/cron/cleanup/route.ts:81-95, docs/operations-spec.md:298`

### MEM-11 — ❓ 要確認

休眠会員のmembersレコード削除後、紐づくSupabase Authユーザー（auth_user_id）があれば管理APIで削除を試みる。Authユーザー削除に失敗した場合でもmembersレコードの削除はロールバックされず、失敗したauth_user_idは応答のauthDeleteErrors配列に含めて返すのみで、孤児化したAuthユーザーへの自動リトライは行われない。

- 根拠: `app/api/cron/cleanup/route.ts:97-113, 116-120`
- ❓ 確認ポイント: 会員削除とAuthユーザー削除がトランザクション的に一体でないため、Auth削除が失敗すると「membersテーブルには存在しないがauth.usersには残る」孤児アカウントが発生しうる。手動対応が必要な運用上のトレードオフであり、オーナーが許容範囲か確認が必要。

### MEM-12 — ⬜ 未確認

会員登録（新規会員作成）RPCは name または auth_user_id が空文字・null・未指定の場合、HTTPステータス400相当のエラー（jsonb内 status:400）を返す。表示名の前後空白はtrimされる。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:60-62`

### MEM-13 — ⬜ 未確認

会員名の変更（PATCH /api/members）は、リクエストのmember_idとname両方が必須で、nameは100文字（MAX_NAME_LENGTH）を超えるとエラーになる。member_idはUUID形式でない場合もエラーになる。

- 根拠: `app/api/members/route.ts:8, 83-94`

### MEM-14 — ⬜ 未確認

会員名の変更は、認証済みユーザーの auth_user_id と対象会員レコードの auth_user_id が一致する場合のみ成功する。一致しない（他人の会員IDを指定した）場合はRPC内のUPDATE文がヒットせず、「会員が見つかりません」相当のエラー（404）が返る。

- 根拠: `supabase/migrations/20260602070000_update_member_name_rpc.sql:20-28`

### MEM-15 — ⬜ 未確認

register_member・update_member_name の両RPCは anon/authenticated ロールから直接実行できず、service_role権限を持つサーバー側APIルート（/api/members）経由でのみ呼び出せる。

- 根拠: `supabase/migrations/20260619010000_member_retention_and_archives.sql:110-112, supabase/migrations/20260603010000_restrict_private_rpc_and_select.sql:13-19`

### MEM-16 — ⬜ 未確認

会員登録（POST /api/members）は、リクエストのauth_user_idと認証トークンのユーザーIDが一致しない場合、本人確認失敗として403エラーを返す（他人になりすました登録はできない）。

- 根拠: `app/api/members/route.ts:38-44`

### MEM-17 — ❓ 要確認

members テーブルへの select は authenticated ロールにのみ許可され（RLSポリシー members_select_authenticated、全件参照可）、anon ロールからは参照できない。会員情報の取得はログイン済みユーザーに限定される。

- 根拠: `supabase/migrations/20260603010000_restrict_private_rpc_and_select.sql:22-26`
- ❓ 確認ポイント: 抽出元リストに欠落していた挙動。members テーブルの参照制御（RLS）そのものは members 領域の重要な振る舞いだが、他テーブルとの関連や運用上の意図まではコードから完全には読み取れないため確認を推奨。

## 5. 管理者機能

### ADM-01 — ⬜ 未確認

管理者ログインはパスワード一致のみで認証する（メールアドレス等の識別子は不要）。パスワードは環境変数 ADMIN_PASSWORD と定数時間比較（timingSafeEqual）で照合する。

- 根拠: `app/api/admin/verify/route.ts:86-87, lib/api-auth.ts:23-39`

### ADM-02 — ⬜ 未確認

管理者ログイン試行回数の上限は15分間で5回。上限に達すると15分間ロックされ、以降の試行は全て「試行回数の上限に達しました」として拒否される（パスワードが正しくてもロック中は拒否）。

- 根拠: `lib/admin-rate-limit.ts:9-11 (ATTEMPT_WINDOW_MS=15分, LOCK_MS=15分, MAX_ATTEMPTS=5), app/api/admin/verify/route.ts:74-78`

### ADM-03 — ✅ 確認済み（2026-07-03 まっすん確認・現状容認）

ログイン試行回数の制限は、接続元IPごとのカウンタ（ip:住所）とサイト全体で共有のグローバルカウンタ（global:admin-login）の両方に同時加算され、どちらか一方でもロック状態なら拒否する。コード内コメントでは「Vercelは本番でx-real-ipを実クライアントIPで常にセットする」ことを信頼の前提としており、x-forwarded-forは client-controlled で信頼できないためフォールバック止まりとしている。グローバルカウンタが本命のブルートフォース対策とされている。

- 根拠: `app/api/admin/verify/route.ts:19-40 (clientIdentifier/rateLimitKeys, コメント含む)`
- 確認結果: トレードオフ（第三者の失敗試行で運営者もロックされ得る）は承知のうえで現状容認。より良い方式の案が出たら再検討。

### ADM-04 — ⬜ 未確認

管理者セッションCookie（キー名 basketball_admin_session）は有効期限8時間（28800秒 = ADMIN_SESSION_MAX_AGE_SECONDS）。Cookie自体はHMAC-SHA256署名付きトークン（有効期限.ランダムnonce.署名）で、有効期限切れ・署名不一致・改ざん・余分なセグメントのいずれかがあれば無効と判定される。

- 根拠: `lib/api-auth.ts:6-7, 41-60`

### ADM-05 — ⬜ 未確認

管理者セッションCookieは HttpOnly・SameSite=Strict・本番環境（NODE_ENV=production）のみSecure属性付き・パス全体(/)に設定される。JavaScriptからは読み取れず、クロスサイトリクエストには送信されない。

- 根拠: `app/api/admin/verify/route.ts:94-103`

### ADM-06 — ⬜ 未確認

ADMIN_SESSION_SECRET が環境変数未設定の場合、パスワードが正しくてもセッショントークンを発行できず（createAdminSessionTokenがnullを返す）、ログインは500エラー「Admin auth is not configured」で失敗する。ログイン画面はこれを「サーバー設定エラーです。管理者設定（ADMIN_SESSION_SECRET）を確認してください」と表示する。

- 根拠: `lib/api-auth.ts:13-21, 41-47, app/api/admin/verify/route.ts:87-91, lib/admin-login-error.ts:8-9`

### ADM-07 — ⬜ 未確認

イベント作成時、定員上限（max_participants）と繰り上げ閾値（threshold）は共に1以上の整数のみ許可され、閾値は定員以下でなければならない。初期値は定員35人・閾値30人。

- 根拠: `app/api/admin/events/route.ts:58-64, 66-71, 90-91, 130-137, app/admin/create/page.tsx:64-65`

### ADM-08 — ⬜ 未確認

イベント作成・編集時、終了日時（event_end_date）は開始日時（event_date）より厳密に後でなければならない（同時刻は不可）。

- 根拠: `app/api/admin/events/route.ts:73-75, 123-125, 312-314`

### ADM-09 — ⬜ 未確認

イベントのタイトルは200文字以内、開催場所は200文字以内、Google Maps等の場所URLは2000文字以内かつ http または https スキームのみ許可される。

- 根拠: `app/api/admin/events/route.ts:10-12, 18-22, 24-41`

### ADM-10 — ⬜ 未確認

イベントのステータスは accepting（受付中）・closed（締切）・draft（下書き）・archived（アーカイブ）の4種類のいずれかのみ許可される。作成時のデフォルトは accepting。

- 根拠: `app/api/admin/events/route.ts:9, 92, 113-115, 279-281`

### ADM-11 — ⬜ 未確認

管理者がイベントのステータスを手動で closed に変更すると is_manual_close フラグが true になり、accepting または draft に手動で戻すと false にリセットされる。is_manual_close=true の間は、参加者のキャンセルで参加枠が閾値を下回っても自動再開しない。

- 根拠: `app/api/admin/events/route.ts:329-336, supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:239 (v_was_active and v_event.status <> 'draft' and not v_event.is_manual_close の条件)`

### ADM-12 — ⬜ 未確認

管理者画面のイベント詳細で「締め切る」ボタンを押すと status を closed に変更する（PATCH経由で is_manual_close=true が設定される）。「再開する」ボタンでは status を accepting に戻す（is_manual_close=false にリセットされる）。下書きの場合は「今すぐ公開」で accepting に変更する。archived の場合はこのトグル操作自体が無効化されている（handleToggleStatus が status==='archived' で即return）。

- 根拠: `app/admin/events/[id]/page.tsx:90-110, 155-158`

### ADM-13 — ⬜ 未確認

イベント削除はUUID形式のIDかつ実在するイベントであることを確認した上で実行され、参加者データも含めて完全に削除される（アーカイブとは異なり復元不可、DBの外部キー ON DELETE CASCADE 等でparticipantsが道連れになる想定）。削除前に確認ダイアログ「参加者データも全て削除されます」が表示される。

- 根拠: `app/api/admin/events/route.ts:227-249, app/admin/events/[id]/page.tsx:112-130`

### ADM-14 — ❓ 要確認

予約公開日時（publishes_at）を設定した下書きイベントは、その日時を過ぎた時点でユーザーが管理者画面・一般APIいずれかにアクセスした瞬間に自動的に accepting へ切り替わる（定期実行のcronではなく、リクエスト駆動でのオンデマンド反映。publishDueDraftEventsが status='draft' かつ publishes_at <= now の行を一括UPDATEする）。

- 根拠: `lib/event-publishing.ts:3-12, app/api/admin/events/route.ts:164-168, app/api/participants/route.ts:26-27, app/api/cancel/route.ts:41-48`
- ❓ 確認ポイント: cronではなくリクエストが来るまで自動公開が反映されない仕組みのため、アクセスが全くない場合は予約公開時刻を過ぎても見かけ上いつまでも下書きのままになりうる。意図した設計か確認が必要

### ADM-15 — ✅ 確認済み（2026-07-11 まっすん確認）

管理者による参加者の強制キャンセル（代理キャンセル、リクエストボディに admin:true を含む）は、管理者セッションCookieが有効であれば実行できるが、イベントが archived（アーカイブ済み）の場合は409エラーで拒否される。管理画面UI側も同時期にアーカイブ済みイベントでは強制キャンセルボタン自体を非表示にしており、UI・API両方で整合を取っている。draft状態は元々参加者が存在しないため実質的な制約対象ではない。一般会員のキャンセルは従来どおり accepting または closed の場合のみ許可される（isVisibleToMembersで判定）。

- 根拠: `app/api/cancel/route.ts:60-67, app/admin/events/[id]/page.tsx（強制キャンセル/取消ボタンのarchived非表示）, lib/event-visibility.ts:8-10`
- 確認結果: 「画面操作でできなくなっているため実害はないが、整合性のためAPI側もブロックする」との回答（まっすん）。2026-07-11 対応済み

### ADM-16 — 🔺 機能追加の意向あり（2026-07-03 まっすん確認）

管理者機能には参加者の代理追加（管理者が本人に代わって参加登録する）APIは存在しない。参加登録（/api/participants POST）は会員のBearerトークン認証等が必須で、admin Cookieによるバイパス経路はない。管理画面のイベント詳細UIにも参加者追加ボタンは無く、強制キャンセルのみが可能。

- 根拠: `app/api/participants/route.ts全体（admin分岐なし）, app/admin/events/[id]/page.tsx:200-282（参加者追加UIなし、強制キャンセルのみ）`
- 確認結果: 機能として追加したい意向。案は ①管理者がユーザ画面から「友達追加」の形式で代理追加する ②管理者画面に同様の追加 UI を設ける、の2案で設計未決定。TASKS.md に機能要望として起票済み（上記の「代理追加なし」は暫定の実装状態）。

### ADM-17 — ⬜ 未確認

管理者はアーカイブ済みイベント一覧（GET /api/admin/events?archived=1）およびアーカイブ済みイベントの詳細・参加者一覧（GET /api/admin/events?id=...、アーカイブ済みでも同じidパラメータで取得可能）を、一般会員には見えない状態でも閲覧できる。管理者画面のトップでは「アーカイブ」ボタンで通常一覧とアーカイブ一覧を切り替える。

- 根拠: `app/api/admin/events/route.ts:170-195, 212-224, app/admin/page.tsx:136, 143-145`

### ADM-18 — ⬜ 未確認

イベントは開催終了日時（event_end_date）を過ぎ、かつステータスが accepting または closed の場合、毎日15:00 UTC（=00:00 JST）に実行される Vercel Cron ジョブ（vercel.json で schedule: "0 15 * * *"）によって自動的に archived へ変更される（is_manual_close も false にリセット）。手動でarchivedへ変更するUIは管理画面上に無い。cronはCRON_SECRETによるBearer認証が必須で、未設定時は500エラーで即座に失敗する。

- 根拠: `vercel.json:2-7, app/api/cron/cleanup/route.ts:13-28, 33-65`

### ADM-19 — 🔺 想定と実装が不一致（2026-07-03 まっすん確認・修正待ち）

管理者画面のイベント編集（PATCH）で、下書き以外のイベントに対しても max_participants・threshold・日時・場所などすべての項目を制限なく変更できる。受付中で既に参加者がいる状態でも定員を参加者数未満に減らすことが技術的には可能（現在の active 参加者数と比較する検証コードは無い。表示上「参加者N/定員M」でN>Mの矛盾表示になり得る）。

- 根拠: `app/api/admin/events/route.ts:252-359（現在の参加者数と比較する検証コードなし）`
- **想定仕様**: 定員（max_participants）を小さくする変更は、現在の active 参加者数を**下回る値には設定できない**（バリデーションで拒否）。参加者数と**同数**に設定した場合は即時受付停止（closed）へ遷移する。上記の現状挙動（無制限に変更可）は想定と不一致。修正タスクを TASKS.md に起票済み（2026-07-03）。

### ADM-20 — ⬜ 未確認

管理者ログイン成功時、レート制限カウンタ（IPキー・グローバルキーの両方）はクリアされる。ログアウト（DELETE /api/admin/verify）はCookieを即時失効させる（maxAge:0で上書き）のみで、レート制限状態には影響しない。

- 根拠: `app/api/admin/verify/route.ts:93, 13-17, 51-53`

### ADM-21 — ⬜ 未確認

イベント作成・編集フォームの日時入力は日本時間（'+09:00'固定文字列を付与してISO変換）として解釈されサーバーに送信される。タイムゾーンの切り替えUIは無い。

- 根拠: `app/admin/create/page.tsx:87-88, 106, app/admin/events/[id]/edit/page.tsx:113-114, 133`

### ADM-22 — ✅ 確認済み（2026-07-03 まっすん確認）

満員による自動締切後、キャンセルによって自動再開する際、max_participants は threshold の値に更新され、元の定員には戻らない。以降そのイベントの定員は threshold 値で運用され、管理画面のイベント編集でもこの更新後の定員が表示・編集対象になる（意図した仕様。EVT-08 / EVT-18 / JOIN-10 と同一仕様の管理者視点）。

- 根拠: `supabase/migrations/20260620010000_remove_event_deadline_auto_close.sql:239-248`

## 6. 自動処理（cron）

### CRON-01 — ⬜ 未確認

Vercel Cronは毎日15:00 UTC（=JST 00:00）に1回、/api/cron/cleanupを呼び出す。

- 根拠: `vercel.json:1-6`

### CRON-02 — ⬜ 未確認

cleanupジョブは終了日時（event_end_date）が現在時刻より過去で、かつステータスが「受付中(accepting)」または「締切(closed)」のイベントを対象に、削除せず「archived」（管理者アーカイブ）へ更新してユーザー画面から隠す。あわせてis_manual_closeフラグをfalseに戻す。

- 根拠: `app/api/cron/cleanup/route.ts:34-38,51-54`

### CRON-03 — ⬜ 未確認

イベントのアーカイブ化は1回のcron実行あたり100件ずつのバッチ（CLEANUP_BATCH_SIZE）でUPDATEを分割実行する（対象が250件なら100・100・50件の3バッチ）。バッチ途中でエラーが出ると、それ以前に成功したarchived件数を保持したまま即座に500エラーで打ち切る（後続バッチは実行しない）。

- 根拠: `app/api/cron/cleanup/route.ts:5,48-65`

### CRON-04 — ⬜ 未確認

cleanupジョブは最終アクセス日時（last_accessed_at）が365日以上前（DORMANT_MEMBER_DAYS）の会員を「休眠会員」として検出し、参加履歴（participants.member_id）をNULL化してから会員レコードを削除する。参加履歴自体は削除せず匿名化されて残る。

- 根拠: `app/api/cron/cleanup/route.ts:6,67-99`

### CRON-05 — ❓ 要確認

休眠会員に認証アカウント（auth_user_id）が紐づく場合、会員レコード削除に続けてSupabase Authユーザーも削除する。Auth削除が失敗しても会員レコードは既に削除済みのため処理は継続し、失敗したauth_user_idはレスポンスのauthDeleteErrorsに記録されるのみで、そのAuthユーザーは孤児として残る（要手動対応）。

- 根拠: `app/api/cron/cleanup/route.ts:96-119`
- ❓ 確認ポイント: 自動修復なしで孤児化したAuthユーザーが放置される設計。運用上、定期的にログを確認して手動削除する運用フローが必要だが、それを検知・実施する仕組みが用意されていない。オーナーが許容できるトレードオフか確認要。

### CRON-06 — ❓ 要確認

休眠会員の検出・削除は1回のcron実行あたり最大100件（CLEANUP_BATCH_SIZE）までしか処理しない（.limit(100)で取得件数自体を制限しており、cleanupのイベントアーカイブのようなバッチ分割ループはない）。365日超の休眠会員が100件を超えて滞留している場合、超過分は翌日以降のcron実行に持ち越される。

- 根拠: `app/api/cron/cleanup/route.ts:5,68-72`
- ❓ 確認ポイント: イベントアーカイブは全件をバッチ処理するのに対し、休眠会員削除は1日100件が上限で全件処理を保証しない非対称な実装。休眠会員が急増した場合に削除が追いつかない可能性があり、意図した仕様か確認要。

### CRON-07 — ⬜ 未確認

cleanupジョブ実行にはCRON_SECRET環境変数が必須で、未設定の場合は認証チェックより先に500エラーを返す（fail-closed）。設定済みの場合、リクエストのAuthorizationヘッダ（Bearer <CRON_SECRET>）とタイミング攻撃耐性のある比較（timingSafeEqual、長さ不一致時もダミー比較を実行してから false を返す）で照合し、不一致なら401エラーを返す。

- 根拠: `app/api/cron/cleanup/route.ts:20-28, lib/api-auth.ts:23-38`

### CRON-08 — ⬜ 未確認

cleanupジョブの各失敗ステップ（イベント取得・アーカイブ更新・休眠会員取得・参加履歴NULL化・会員削除・Authユーザー削除）は、失敗理由をconsole.errorへ「cron/cleanup:」プレフィックス付きで出力し、Vercelのファンクションログから検索可能にしている。

- 根拠: `app/api/cron/cleanup/route.ts:41,57,75,89,102,115`

### CRON-09 — ⬜ 未確認

参加履歴のNULL化に失敗した場合、その会員の削除処理は行わない（履歴保全を優先し、削除前に必ずNULL化を成功させる）。NULL化成功後に会員削除が失敗した場合は500エラーで打ち切る。いずれの失敗時も、既に処理済みのarchived・deletedMembers件数を保持したままレスポンスされる。

- 根拠: `app/api/cron/cleanup/route.ts:82-107`

### CRON-10 — ⬜ 未確認

下書き予約公開（publishes_atを過ぎたdraftイベントをacceptingへ昇格しis_manual_closeをfalseにリセット）は、Supabaseのpg_cronジョブ「publish_due_draft_events」が毎分（* * * * *）実行することで担う。Vercel Cronのスケジュールには含まれない。

- 根拠: `supabase/migrations/20260614031000_schedule_due_draft_promotion.sql:1-32, vercel.json:1-6`

### CRON-11 — ⬜ 未確認

/api/cron/publish-draftsエンドポイントは同じ昇格処理（publishDueDraftEvents）を実行できるが、vercel.jsonのcron定義には登録されておらず、CRON_SECRET認証つきの手動実行専用フォールバックとして存在する（自動実行はされない）。

- 根拠: `app/api/cron/publish-drafts/route.ts:1-27, vercel.json:1-6, docs/cron-environment.md:22-29`

### CRON-12 — ❓ 要確認

下書き公開の昇格処理（publishDueDraftEvents）は、pg_cronの毎分実行に加えて、会員向けトップページ（/、イベント一覧取得）とイベント詳細ページ（/events/[id]）のServer Componentレンダリング時、管理者イベント一覧取得（/api/admin/events GET）、参加キャンセル（/api/cancel POST）、参加登録・取得（/api/participants POST・GET、event_id指定時とmember一覧取得時の両方）の各リクエスト時にもアプリ側で同期的に実行される。特に会員向けの2ページはユーザーが通常のページ閲覧で最も頻繁にアクセスする経路であり、pg_cronが何らかの理由で止まっていても、これらの操作をトリガーに昇格が反映される仕組みになっている。

- 根拠: `app/page.tsx:6,14, app/events/[id]/page.tsx:6,19, app/api/admin/events/route.ts:6,165, app/api/cancel/route.ts:7,42, app/api/participants/route.ts:7,27,86`
- ❓ 確認ポイント: docs/operations-spec.md:188は「管理者がイベント一覧を開いたタイミング」とのみ記述しているが、実際には会員向けトップページ・イベント詳細ページの通常閲覧、キャンセル、参加登録・参加情報取得の各APIでも同様のフォールバックが走っており、ドキュメントの記述範囲より実装の適用範囲がはるかに広い。ドキュメント更新が必要か、あるいは意図した設計範囲か確認要。

### CRON-13 — ⬜ 未確認

publish_due_draft_events()関数はSECURITY DEFINERで定義されたSQL関数で、実行者の権限に関わらずpublicスキーマ内で固定のsearch_pathのもと動作し、draftステータスかつpublishes_atが設定済みでその日時を過ぎたイベントをacceptingへ更新する（is_manual_closeもfalseにリセットする）。

- 根拠: `supabase/migrations/20260614031000_schedule_due_draft_promotion.sql:1-13`

### CRON-14 — ❓ 要確認

pg_cron拡張機能（pg_cron extension）がSupabaseプロジェクトで有効化されていない場合、該当migrationの実行自体が失敗する。

- 根拠: `supabase/migrations/20260614031000_schedule_due_draft_promotion.sql:15, docs/DEPLOY_RUNBOOK.md:221-222`
- ❓ 確認ポイント: pg_cron拡張の有効化状態は本番環境で目視確認が必要な運用依存項目（DEPLOY_RUNBOOK上も「要確認」の位置づけ）。オーナー側で最終確認済みかどうか要確認。

### CRON-15 — ⬜ 未確認

publish_due_draft_eventsのpg_cronジョブ登録はmigration適用のたびに冪等に再設定される（同名ジョブが既に存在すればunscheduleしてから再scheduleする）ため、migrationを複数回流しても重複ジョブは作られない。

- 根拠: `supabase/migrations/20260614031000_schedule_due_draft_promotion.sql:17-32`

### CRON-16 — ✅ 確認済み（2026-07-03 まっすん確認・現状維持）

会員の「最終アクセス日時」（last_accessed_at、休眠会員365日判定の基準値）は、Cookieセッションから会員情報を解決した際に、前回更新から24時間（LAST_ACCESS_TOUCH_INTERVAL_MS）以上経過している場合のみ更新される（毎リクエストでは更新されない間引き設計）。

- 根拠: `lib/server-member.ts:6,8-18,54-56`
- 確認結果: 現状維持（MEM-08 と同一仕様の cron 視点。docs 側の記述修正のみ TASKS.md 起票済み）。

### CRON-17 — ⬜ 未確認

Vercel CronとSupabase pg_cronのいずれも、CRON_SECRET未設定時は500・認証不一致時は401という同一のfail-closed認証パターンをGETエンドポイント側（/api/cron/cleanup、/api/cron/publish-drafts）で共有している。pg_cronのDB関数自体（publish_due_draft_events）にはCRON_SECRETのようなアプリ層認証はなく、DB内部から直接呼ばれる前提でSECURITY DEFINERにより権限を制御している。

- 根拠: `app/api/cron/cleanup/route.ts:20-28, app/api/cron/publish-drafts/route.ts:7-15, supabase/migrations/20260614031000_schedule_due_draft_promotion.sql:1-5`

## 7. セキュリティ・可視性

### SEC-01 — ✅ 確認済み（2026-07-03 まっすん確認）

トップページ（/）およびイベント詳細ページ（/events/[id]）を含むほぼ全ページは、middleware(proxy.ts)でSupabase Authのログインセッションが無い場合 /login へ強制リダイレクトされる。ログインしていない人はイベント一覧・詳細・参加者名簿のいずれも閲覧できない（唯一の例外は /admin配下、/login, /register, /auth/callback, /api配下, /_next配下, /favicon.ico）。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\proxy.ts:61-117（特に74-84の除外パスと108-114のリダイレクト）, C:\ClaudeCode\90_projects\03_basketball-circle\app\page.tsx:1-57`
- 確認結果: 想定どおり（完全会員制サイト。未ログインには一覧も見せない）。

### SEC-02 — ⬜ 未確認

会員（ログイン済みユーザー）に表示されるイベントは status が accepting または closed のイベントのみ。draft（下書き・未公開）と archived（アーカイブ済み）のイベントは一覧にも詳細ページにも表示されない。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\lib\event-visibility.ts:8-10, app\page.tsx:22, app\events\[id]\page.tsx:25`

### SEC-03 — ⬜ 未確認

draft イベントは publishes_at（公開予約日時）が現在時刻以下になった時点で、ページ表示直前に自動的に status=accepting へ昇格する（cronだけでなく通常のページ閲覧・参加API呼び出し時にも都度この昇格処理が走る）。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\lib\event-publishing.ts:1-12, app\page.tsx:14, app\events\[id]\page.tsx:19, app\api\participants\route.ts:27`

### SEC-04 — ⬜ 未確認

参加者名簿（参加者一覧）で会員・ゲスト全員に公開される情報は、氏名(name)・参加ステータス(status)・スロット番号(slot_number)・参加登録日時(created_at)・ゲスト用の表示コード(display_code)のみ。参加者のuser_code（キャンセル検証コード）とmember_id（会員との紐付け）はAPIレスポンス・画面props双方から必ず除去される。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\lib\participation-query.ts:19-32（toPublicParticipant、コメント含む）, app\events\[id]\page.tsx:29-38（participants_publicビューをselectするカラムを列挙）`

### SEC-05 — ⬜ 未確認

participants_public ビューは security_invoker=true（呼び出し元権限で実行）に設定されており、anon・authenticatedロールへのSELECT権限はrevokeされ、service_roleのみがSELECT可能。ブラウザ（anonキー）から直接このビューを読むことはできず、Next.jsサーバー側（service_roleキー使用）を経由した場合のみ参加者名簿が取得できる。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\supabase\migrations\20260619020000_participants_public_security_invoker.sql:1-9`

### SEC-06 — ⬜ 未確認

events・members・participantsの3テーブルはRLSの直接INSERT/UPDATE/DELETEポリシーがすべて『false』（常に拒否）に設定されており、ブラウザ（anon/authenticatedキー）からの直接書き込みは一切できない。すべての作成・更新・削除はNext.jsのAPIルートがservice_roleキー（RLSを完全バイパスする権限）で実行する設計。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\supabase\migrations\20260527040000_harden_public_mutation_policies.sql:1-43`

### SEC-07 — ❓ 要確認

events テーブルの最新RLS SELECTポリシーは『authenticatedロールかつstatusがaccepting/closedのいずれか』のみを許可し、anonロールにはSELECTポリシーが存在しない（＝anonキーでは1件も読めない）。ただしアプリの実データ取得はすべてservice_roleキー経由でRLSをバイパスしており、実際の可視性制御はDB側RLSではなくアプリ層（isVisibleToMembers関数）のフィルタで行われている。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\supabase\migrations\20260619010000_member_retention_and_archives.sql:20-24（events_selectポリシー: status in ('accepting','closed')）, lib\supabase-server.ts:7-24`
- ❓ 確認ポイント: 現状のRLSポリシー(authenticated かつ accepting/closedのみ)とアプリ層のisVisibleToMembers(accepting/closedのみ)は基準が一致しているため二重管理としての実害は小さいが、依然として二箇所に同じロジックが分散しておりドリフトのリスクがある。アプリのAPIルートがservice_roleではなくanon/authenticatedキーを誤用した場合の挙動を含め、オーナーに『実質的な可視性制御はアプリコードに一任している』設計であることの認識合わせが必要。

### SEC-08 — ⬜ 未確認

join_event（参加申請）・cancel_participant（キャンセル）・register_member（会員登録）・update_member_name（ニックネーム変更）の4つのRPC関数はいずれもservice_roleにのみEXECUTE権限が付与されており、anon・authenticatedロールから直接RPC呼び出しはできない（Next.jsのAPIルートを経由必須）。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\supabase\migrations\20260603010000_restrict_private_rpc_and_select.sql:5-19（4関数すべてのrevoke/grantを一括定義）, supabase\migrations\20260602060000_revoke_register_member_anon_execute.sql:5-7, supabase\migrations\20260602070000_update_member_name_rpc.sql:39-40`

### SEC-09 — ⬜ 未確認

参加申請API（POST /api/participants）とキャンセルAPI（POST /api/cancel）は、Authorizationヘッダのbearerトークン（Supabase Auth）で本人確認したうえで、リクエストのmember_id/participant_idが実際にそのログインユーザー本人（またはその会員が追加したゲスト）のものであることをサーバー側で検証してから処理する。他会員のIDを指定してもエラーになる。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\lib\api-auth.ts:84-116（getAuthenticatedMember、特に111-113の本人確認）, app\api\cancel\route.ts:69-77（ownsGuestチェック含む）`

### SEC-10 — ❓ 要確認

キャンセルAPI（POST /api/cancel）には、Supabase Authでログインしていない旧来ユーザー向けの経路が残っており、参加者がmember_idを持たずuser_codeがguest:で始まらない場合に限り、リクエストのuser_codeがDB保存値と一致すればログイン無しでキャンセルできる（レガシー参加者向けの互換処理）。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\app\api\cancel\route.ts:78-84（コメント「Legacy non-member cancellations are still allowed by temporary code.」）`
- ❓ 確認ポイント: 現在は全ページがログイン必須（proxy.ts）で新規参加はすべて会員経由のため、このレガシー経路は移行前データ専用の想定。ただし該当データが残っている限り無期限に有効な抜け道であり、いつまで維持するか（移行完了後に廃止するか）オーナー確認が必要。

### SEC-11 — ✅ 確認済み（2026-07-03 まっすん確認）

管理者向けAPI（/api/admin/events の GET/POST/PATCH/DELETE、/api/cancel のadmin=true指定時）は、httpOnlyクッキー basketball_admin_session に保存された署名付きセッショントークン（HMAC-SHA256、有効期限8時間）の検証のみで認可され、Supabase Authのログイン状態とは無関係の別ログイン系統。管理者パスワードは環境変数ADMIN_PASSWORDの単一の共有パスワードで、会員ごとの個別アカウントは存在しない。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\lib\api-auth.ts:6-7,41-64,84-116, app\api\admin\verify\route.ts:67-108, app\api\admin\events\route.ts:77-80,159-162,227-230,252-255`
- 確認結果: 現状はこの方式（単一共有パスワード・操作者の個別追跡なし）でよい。

### SEC-12 — ⬜ 未確認

管理者ログイン（POST /api/admin/verify）は15分間の試行ウィンドウ内で5回失敗するとロックされ、以後15分間はそのIPからのログインが拒否される（429）。加えてIP偽装対策として『IPごと』のロックとは別に『全体共有』のロックキーも同時にカウントされ、いずれか一方がロック状態でもログイン試行がブロックされる。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\lib\admin-rate-limit.ts:9-11, app\api\admin\verify\route.ts:11,38-45,75-78`

### SEC-13 — ⬜ 未確認

本番環境（Vercel）ではx-real-ipヘッダは常にVercelが実クライアントIPで上書き設定するため信頼できるが、x-forwarded-forヘッダは最終手段のフォールバックでしかなくクライアントが偽装可能。IPごとのレート制限はx-real-ip不在時のみx-forwarded-forに頼るため、単独のIP偽装ではロックを回避できない設計だが、x-real-ip自体が欠落する状況ではIP単位の制限が事実上unknown単一キーに縮退する。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\app\api\admin\verify\route.ts:19-36`

### SEC-14 — ⬜ 未確認

会員ログインのセッションCookie（Supabase Auth JWT）はサーバー側で必ずauth.getUser()による検証済みデコードのみを使用し、Cookie内のJWTペイロードを未検証のままデコードして会員情報を信頼することは禁止されている（偽造Cookieによるなりすまし防止）。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\lib\server-member.ts:44-46（コメント含む）`

### SEC-15 — ⬜ 未確認

全ページ共通のHTTPセキュリティヘッダとして、X-Frame-Options: DENY（他サイトへのiframe埋め込み全面禁止）、X-Content-Type-Options: nosniff、Referrer-Policy: strict-origin-when-cross-origin、および厳格なContent-Security-Policy（script-srcは自ドメインとGoogle Maps関連のみ許可・frame-ancestors none・connect-srcは自ドメインとSupabase・Google Mapsのみ許可）が全レスポンスに付与される。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\next.config.ts:29-70`

### SEC-16 — ❓ 要確認

Content-Security-PolicyのCSP script-srcには'unsafe-inline'と'unsafe-eval'が許可されており、XSS対策としてのCSPのスクリプト実行制限は緩い（インラインスクリプトや動的評価コードの実行を明示的にブロックしていない）。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\next.config.ts:46`
- ❓ 確認ポイント: 'unsafe-inline'/'unsafe-eval'はNext.jsの一部機能（インラインスタイル・特定のクライアント処理）で必要になりがちだが、これによりCSPのXSS防御効果はかなり限定的になる。意図的なトレードオフか、将来nonceベースへ強化する計画があるかオーナー・開発チームで確認が必要。

### SEC-17 — ⬜ 未確認

管理者画面（/admin配下、/admin自体は除く）はmiddlewareでセッションクッキー検証のみを行いページ遷移をリダイレクトするが、これはUIの入口制御であり、実際のデータ操作の認可は各/api/admin/*ルート内のcheckAdmin()が個別に行う（middlewareの保護対象は/admin配下のページ表示のみで、/api配下は明示的にmiddlewareの認証チェック対象外）。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\proxy.ts:64-84（/adminブロックと/apiの除外パスの両方を明記）`

### SEC-18 — ❓ 要確認

管理者用イベントAPI（GET /api/admin/events?id=...）は参加者情報をparticipants_publicビューではなくparticipantsテーブルを直接select('*')で取得しており、user_codeを含む生データ（キャンセル検証コードなど）がそのまま管理者クライアントへ返される。ただし管理画面フロントエンド（app/admin配下）はこのuser_codeを画面に表示していない。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\app\api\admin\events\route.ts:186-193`
- ❓ 確認ポイント: 会員向けAPIはuser_codeを常に除去する設計方針(participation-query.tsのコメント)だが、管理者向けAPIはこの方針の適用対象外として意図的に生データを返している。フロントエンドは未使用のためすぐの実害はないが、意図（運営には見せてよい）か見落としかの整理が必要。

### SEC-19 — ⬜ 未確認

会員テーブル(members)のRLS SELECTポリシーはauthenticatedロールに対しauth.uid() = auth_user_idの条件で自分自身の行のみ許可（members_select_own）。ただしアプリのAPIルート・Server Componentはservice_roleキー経由で全会員データを読むため、このRLS制約はブラウザ側anon/authenticatedキーを直接使った場合にのみ効く保険的な制御。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\supabase\migrations\20260603030000_public_participants_view.sql:29-35`

### SEC-20 — ⬜ 未確認

Vercel Cronから呼ばれる /api/cron/cleanup（休眠会員削除・期限切れイベントのアーカイブ化）と /api/cron/publish-drafts（予約公開の反映）は、Supabase Authでも管理者クッキーでもなく、環境変数CRON_SECRETと一致するAuthorizationヘッダ（Bearer方式、safeCompareによる定数時間比較）でのみ認可される。CRON_SECRET未設定時は常に500を返し実行されない。

- 根拠: `C:\ClaudeCode\90_projects\03_basketball-circle\app\api\cron\cleanup\route.ts:19-28, app\api\cron\publish-drafts\route.ts:6-15`
