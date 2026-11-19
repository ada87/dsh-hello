/**
 * Browser half of dsh-hello.
 *
 * Ships one surface: a top-level Settings section, ordered just after General
 * (order 5) so it is not the first menu item. There is no standalone page; the
 * React panel reads the Host's `/admin/data` and `/admin/pair-code` endpoints.
 *
 * This file is hand-written in the lazy-CJS factory format the dsh client
 * module system expects. build.mjs copies it to lib/client.js.
 */
window.__ModuleLoader__.load({
  id: 'dsh-hello',
  factory(require) {
    const React = require('react')
    const { Button, Input } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Wrap one phrase of a sentence in <strong> without adding markup keys. */
    const emphasize = (text, phrase) => {
      const at = phrase.length === 0 ? -1 : text.indexOf(phrase)
      if (at < 0) return text
      return [
        text.slice(0, at),
        h('strong', { key: 'em' }, phrase),
        text.slice(at + phrase.length),
      ]
    }

    const NS = 'dshDoorAdmin'
    const injected = globalThis.__DSH_DOOR__
    const BASE = typeof injected?.basePath === 'string' && injected.basePath.length > 0
      ? injected.basePath.replace(/\/$/, '')
      : '/dsh-hello'
    // The Settings page knows the address it was loaded from; the Host's bind
    // address does not. Send it with every admin request so the QR follows the
    // public/actual URL, including behind a NAT.
    const adminBaseQuery = () => {
      try {
        return '?base=' + encodeURIComponent(new URL('.', location.href).href)
      } catch {
        return ''
      }
    }

    const styles = `
.dd-page{display:flex;flex-direction:column;width:100%;gap:0}
.dd-head{padding:0 0 18px}
.dd-title{font-size:18px;font-weight:600;margin:0 0 4px;color:var(--dsw-alias-label-primary)}
.dd-desc{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dd-oneLine{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dd-row{display:flex;gap:24px;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.22))}
.dd-rowTop{flex-wrap:wrap;row-gap:10px}
.dd-rowTop .dd-rowText{flex:1 1 240px}
.dd-rowTop .dd-control{margin-left:auto}
.dd-rowHead{border-bottom:none;padding-bottom:0}
.dd-row:last-child{border-bottom:none}
.dd-rowText{display:flex;flex-direction:column;gap:4px;min-width:0}
.dd-label{font-size:14px;color:var(--dsw-alias-label-primary)}
.dd-control{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0}
.dd-block{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.22))}
.dd-code{font:600 20px ui-monospace,monospace;letter-spacing:3px;color:var(--dsw-alias-brand-primary,#3d7bfd)}
.dd-segment{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dd-segmentButton{height:28px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.dd-segmentButton.is-active{background:var(--dsw-alias-surface-primary,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dd-countdown{font-size:12px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.dd-modalBackdrop{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}
.dd-modal{display:flex;flex-direction:column;gap:12px;width:min(380px,90vw);padding:18px;border-radius:12px;background:var(--dsw-alias-surface-primary,#fff);box-shadow:0 12px 40px rgba(0,0,0,.28)}
.dd-modalTitle{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary,#111)}
.dd-modal .dd-desc strong{font-weight:600;color:var(--dsw-alias-label-primary,#111)}
.dd-modalActions{display:flex;justify-content:flex-end;gap:8px}
.dd-modalInput{box-sizing:border-box;width:100%;max-width:100%;min-width:0}
.dd-qr{font-size:10px;line-height:1;overflow:auto;margin:0;color:var(--dsw-alias-label-secondary);max-height:220px}
.dd-qr-img{display:flex;justify-content:flex-start;align-self:flex-start;background:#fff;border-radius:8px;padding:8px}
.dd-qr-failed{display:flex;flex-direction:column;gap:4px}
.dd-qr-reason{font-family:ui-monospace,monospace;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary,#888);word-break:break-all}
.dd-qr-img svg{width:220px;height:220px;display:block}
.dd-table{width:100%;border-collapse:collapse;font-size:13px}
.dd-table th,.dd-table td{text-align:left;padding:8px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.18));color:var(--dsw-alias-label-secondary)}
.dd-table th{font-weight:500;color:var(--dsw-alias-label-tertiary)}
.dd-devices{display:flex;flex-direction:column;margin-top:2px}
.dd-device{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;padding:14px 0;border-bottom:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.18))}
.dd-device:last-child{border-bottom:0}
.dd-deviceInfo{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dd-deviceNameRow{display:flex;align-items:center;gap:8px;min-width:0}
.dd-deviceName{font-size:14px;color:var(--dsw-alias-label-primary,#111)}
.dd-rename{padding:0;border:0;background:transparent;color:var(--dsw-alias-link,var(--dsw-alias-brand-primary,#3d7bfd));font:inherit;font-size:12px;cursor:pointer}
.dd-rename:disabled{opacity:.45;cursor:default}
.dd-deviceMeta{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#888);word-break:break-all}
.dd-deviceSide{display:flex;align-items:center;gap:20px;flex:none}
.dd-deviceTimes{display:flex;flex-direction:column;gap:3px;text-align:right}
.dd-deviceTime{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}
.dd-deviceAction{flex:none}
.dd-deviceAction button{white-space:nowrap;color:var(--dsw-alias-state-error-primary,#e5484d)!important}
.dd-deviceAction button:hover{background:var(--dsw-alias-state-error-primary,#e5484d)!important;color:#fff!important}
@media (max-width:640px){
  .dd-device{flex-wrap:wrap}
  .dd-deviceSide{width:100%;justify-content:space-between}
}
.dd-error{color:var(--dsw-alias-state-error-primary,#f87171);font-size:13px;margin:0}
.dd-link{color:var(--dsw-alias-link,var(--dsw-alias-brand-primary,#3d7bfd))}
.dd-input{width:180px}
`

    const zh = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: '配对码',
      lockMode: '锁定',
      lockHintOn: '已锁定：新设备无法配对，已连接的设备照常使用',
      oneTimeMode: '一次性',
      fixedMode: '永久性',
      interactionTitle: '审批与提问',
      interactionDefault: '默认',
      interactionDshFirst: 'DSH 优先',
      interactionDeviceFirst: '设备优先',
      interactionHintDefault: '不发给手机，只在网页处理',
      interactionHintDshFirst: '网页开着时由网页作答',
      interactionHintDeviceFirst: '优先发给正在使用的设备',
      remaining: '剩余 {time}',
      modify: '修改',
      setPermanentTitle: '设置永久配对码',
      setPermanentDesc: '输入 4 位数字，将作为永久配对码。',
      digitsFour: '4 位数字',
      digitsNew: '新的 4 位数字',
      modifyTitle: '修改永久配对码',
      modifyDesc: '输入新的 4 位数字，旧永久码会立即失效。',
      passwordPlaceholder: '4 位数字',
      passwordInvalid: '请输入 4 位数字',
      confirm: '确定',
      cancel: '取消',
      qrTitle: '扫码/输入',
      qrFailed: '二维码生成失败',
      qrLoading: '二维码加载中…',
      qrHint: '请用手机打开 DSH Hello，连接 → 添加服务器 → 使用插件配对 → 扫描二维码。',
      devices: '已配对设备',
      device: '设备',
      pairedAt: '配对时间',
      lastSeen: '最近连接',
      actions: '操作',
      revoke: '移除',
      rename: '改名',
      renameTitle: '重命名设备',
      renameDesc: '只修改显示名称，不影响已配对连接。',
      renameEmpty: '设备名称不能为空',
      revokeConfirm: '移除设备「{name}」？它需要重新配对才能连接。',
      via: '地址',
      noDevices: '还没有设备',
      codeLost: '登录已失效，请刷新 dsh Web UI',
      operationFailed: '操作失败',
    }

    const en = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: 'Pairing code',
      lockMode: 'Lock',
      lockHintOn: 'Locked: new devices cannot pair, while paired devices keep working',
      oneTimeMode: 'One-time',
      fixedMode: 'Permanent',
      interactionTitle: 'Approvals & questions',
      interactionDefault: 'Default',
      interactionDshFirst: 'DSH first',
      interactionDeviceFirst: 'Device first',
      interactionHintDefault: 'Web UI only; nothing reaches devices',
      interactionHintDshFirst: 'The open web UI answers first',
      interactionHintDeviceFirst: 'The device in use answers first',
      remaining: '{time} left',
      modify: 'Change',
      setPermanentTitle: 'Set a permanent pairing code',
      setPermanentDesc: 'Enter four digits to use as the permanent pairing code.',
      digitsFour: 'four digits',
      digitsNew: 'four new digits',
      modifyTitle: 'Change the permanent pairing code',
      modifyDesc: 'Enter four new digits; the old permanent code stops working immediately.',
      passwordPlaceholder: 'Four digits',
      passwordInvalid: 'Enter four digits',
      confirm: 'Confirm',
      cancel: 'Cancel',
      qrTitle: 'Scan or type',
      qrFailed: 'Could not build the QR code',
      qrLoading: 'Loading QR…',
      qrHint: 'Open DSH Hello on your phone, then Connection → Add server → Plugin pairing → Scan QR code.',
      devices: 'Paired devices',
      device: 'Device',
      pairedAt: 'Paired',
      lastSeen: 'Last seen',
      actions: 'Actions',
      revoke: 'Remove',
      rename: 'Rename',
      renameTitle: 'Rename device',
      renameDesc: 'Only the display name changes; the pairing stays connected.',
      renameEmpty: 'The device name cannot be empty',
      revokeConfirm: 'Remove “{name}”? It must pair again to reconnect.',
      via: 'Via',
      noDevices: 'No devices yet',
      codeLost: 'Session expired. Reload the dsh Web UI.',
      operationFailed: 'Operation failed',
    }

    const ja = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: 'ペアリングコード',
      lockMode: 'ロック',
      lockHintOn: 'ロック中: 新しいデバイスはペアリングできません。ペアリング済みのデバイスはそのまま使えます',
      oneTimeMode: 'ワンタイム',
      fixedMode: '固定',
      interactionTitle: '承認と質問',
      interactionDefault: '既定',
      interactionDshFirst: 'DSH 優先',
      interactionDeviceFirst: 'デバイス優先',
      interactionHintDefault: 'デバイスには送らず、Web でのみ処理',
      interactionHintDshFirst: 'Web を開いている間は Web が応答',
      interactionHintDeviceFirst: '使用中のデバイスが先に応答',
      remaining: '残り {time}',
      modify: '変更',
      setPermanentTitle: '固定ペアリングコードを設定',
      setPermanentDesc: '4 桁の数字を入力すると固定ペアリングコードになります。',
      digitsFour: '4 桁の数字',
      digitsNew: '新しい 4 桁の数字',
      modifyTitle: '固定ペアリングコードを変更',
      modifyDesc: '新しい 4 桁の数字を入力すると、以前の固定コードはすぐに無効になります。',
      passwordPlaceholder: '4 桁の数字',
      passwordInvalid: '4 桁の数字を入力してください',
      confirm: '確定',
      cancel: 'キャンセル',
      qrTitle: 'スキャン / 入力',
      qrFailed: 'QR コードを生成できませんでした',
      qrLoading: 'QR を読み込み中…',
      qrHint: 'スマートフォンで DSH Hello を開き、接続 → サーバーを追加 → プラグインでペアリング → QR コードをスキャンします。',
      devices: 'ペアリング済みデバイス',
      device: 'デバイス',
      pairedAt: 'ペアリング日時',
      lastSeen: '最終接続',
      actions: '操作',
      revoke: '削除',
      rename: '名前を変更',
      renameTitle: 'デバイス名を変更',
      renameDesc: '表示名だけを変更します。ペアリング接続は影響を受けません。',
      renameEmpty: 'デバイス名は空にできません',
      revokeConfirm: '「{name}」を削除しますか？再接続には再度ペアリングが必要です。',
      via: '経由',
      noDevices: 'デバイスはまだありません',
      codeLost: '認証が切れました。dsh Web UI を再読み込みしてください。',
      operationFailed: '操作に失敗しました',
    }

    const es = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: 'Código de emparejamiento',
      lockMode: 'Bloquear',
      lockHintOn: 'Bloqueado: los dispositivos nuevos no pueden emparejarse; los ya emparejados siguen funcionando',
      oneTimeMode: 'De un uso',
      fixedMode: 'Permanente',
      interactionTitle: 'Aprobaciones y preguntas',
      interactionDefault: 'Predeterminado',
      interactionDshFirst: 'DSH primero',
      interactionDeviceFirst: 'Dispositivo primero',
      interactionHintDefault: 'Solo en la web; no se envía a dispositivos',
      interactionHintDshFirst: 'La web responde mientras está abierta',
      interactionHintDeviceFirst: 'Responde primero el dispositivo en uso',
      remaining: 'Quedan {time}',
      modify: 'Cambiar',
      setPermanentTitle: 'Definir un código permanente',
      setPermanentDesc: 'Introduce cuatro dígitos para usarlos como código permanente.',
      digitsFour: 'cuatro dígitos',
      digitsNew: 'cuatro dígitos nuevos',
      modifyTitle: 'Cambiar el código permanente',
      modifyDesc: 'Introduce cuatro dígitos nuevos; el código permanente anterior deja de funcionar de inmediato.',
      passwordPlaceholder: 'Cuatro dígitos',
      passwordInvalid: 'Introduce cuatro dígitos',
      confirm: 'Confirmar',
      cancel: 'Cancelar',
      qrTitle: 'Escanear o escribir',
      qrFailed: 'No se pudo generar el código QR',
      qrLoading: 'Cargando QR…',
      qrHint: 'Abre DSH Hello en tu teléfono y ve a Conexión → Añadir servidor → Emparejamiento por plugin → Escanear el código QR.',
      devices: 'Dispositivos emparejados',
      device: 'Dispositivo',
      pairedAt: 'Emparejado',
      lastSeen: 'Última conexión',
      actions: 'Acciones',
      revoke: 'Quitar',
      rename: 'Renombrar',
      renameTitle: 'Renombrar dispositivo',
      renameDesc: 'Solo cambia el nombre visible; el emparejamiento se mantiene.',
      renameEmpty: 'El nombre no puede estar vacío',
      revokeConfirm: '¿Quitar «{name}»? Tendrá que emparejarse de nuevo.',
      via: 'Vía',
      noDevices: 'Aún no hay dispositivos',
      codeLost: 'La sesión ha caducado. Recarga la dsh Web UI.',
      operationFailed: 'La operación falló',
    }

    const fr = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: 'Code d’appairage',
      lockMode: 'Verrouiller',
      lockHintOn: 'Verrouillé : les nouveaux appareils ne peuvent pas s’appairer, les appareils déjà appairés continuent de fonctionner',
      oneTimeMode: 'Usage unique',
      fixedMode: 'Permanent',
      interactionTitle: 'Approbations et questions',
      interactionDefault: 'Par défaut',
      interactionDshFirst: 'DSH d’abord',
      interactionDeviceFirst: 'Appareil d’abord',
      interactionHintDefault: 'Uniquement sur le Web ; rien n’est envoyé aux appareils',
      interactionHintDshFirst: 'L’interface Web répond tant qu’elle est ouverte',
      interactionHintDeviceFirst: 'L’appareil en cours d’utilisation répond en premier',
      remaining: 'Reste {time}',
      modify: 'Modifier',
      setPermanentTitle: 'Définir un code permanent',
      setPermanentDesc: 'Saisissez quatre chiffres pour en faire le code permanent.',
      digitsFour: 'quatre chiffres',
      digitsNew: 'quatre nouveaux chiffres',
      modifyTitle: 'Modifier le code permanent',
      modifyDesc: 'Saisissez quatre nouveaux chiffres ; l’ancien code permanent cesse de fonctionner immédiatement.',
      passwordPlaceholder: 'Quatre chiffres',
      passwordInvalid: 'Saisissez quatre chiffres',
      confirm: 'Confirmer',
      cancel: 'Annuler',
      qrTitle: 'Scanner ou saisir',
      qrFailed: 'Impossible de générer le QR code',
      qrLoading: 'Chargement du QR…',
      qrHint: 'Ouvrez DSH Hello sur votre téléphone, puis Connexion → Ajouter un serveur → Appairage par plugin → Scanner le QR code.',
      devices: 'Appareils appairés',
      device: 'Appareil',
      pairedAt: 'Appairé',
      lastSeen: 'Dernière connexion',
      actions: 'Actions',
      revoke: 'Retirer',
      rename: 'Renommer',
      renameTitle: 'Renommer l’appareil',
      renameDesc: 'Seul le nom affiché change ; l’appairage reste actif.',
      renameEmpty: 'Le nom ne peut pas être vide',
      revokeConfirm: 'Retirer « {name} » ? Il devra s’appairer de nouveau.',
      via: 'Via',
      noDevices: 'Aucun appareil pour l’instant',
      codeLost: 'Session expirée. Rechargez l’interface Web dsh.',
      operationFailed: 'Échec de l’opération',
    }

    const de = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: 'Kopplungscode',
      lockMode: 'Sperren',
      lockHintOn: 'Gesperrt: neue Geräte können nicht koppeln, bereits gekoppelte funktionieren weiter',
      oneTimeMode: 'Einmalig',
      fixedMode: 'Dauerhaft',
      interactionTitle: 'Freigaben und Fragen',
      interactionDefault: 'Standard',
      interactionDshFirst: 'DSH zuerst',
      interactionDeviceFirst: 'Gerät zuerst',
      interactionHintDefault: 'Nur im Web; nichts wird an Geräte gesendet',
      interactionHintDshFirst: 'Die offene Web-Oberfläche antwortet',
      interactionHintDeviceFirst: 'Das verwendete Gerät antwortet zuerst',
      remaining: 'Noch {time}',
      modify: 'Ändern',
      setPermanentTitle: 'Dauerhaften Kopplungscode festlegen',
      setPermanentDesc: 'Vier Ziffern eingeben, die als dauerhafter Code gelten.',
      digitsFour: 'vier Ziffern',
      digitsNew: 'vier neue Ziffern',
      modifyTitle: 'Dauerhaften Kopplungscode ändern',
      modifyDesc: 'Vier neue Ziffern eingeben; der alte Code verliert sofort seine Gültigkeit.',
      passwordPlaceholder: 'Vier Ziffern',
      passwordInvalid: 'Bitte vier Ziffern eingeben',
      confirm: 'Bestätigen',
      cancel: 'Abbrechen',
      qrTitle: 'Scannen oder eingeben',
      qrFailed: 'QR-Code konnte nicht erzeugt werden',
      qrLoading: 'QR wird geladen…',
      qrHint: 'DSH Hello am Telefon öffnen, dann Verbindung → Server hinzufügen → Plugin-Kopplung → QR-Code scannen.',
      devices: 'Gekoppelte Geräte',
      device: 'Gerät',
      pairedAt: 'Gekoppelt',
      lastSeen: 'Zuletzt verbunden',
      actions: 'Aktionen',
      revoke: 'Entfernen',
      rename: 'Umbenennen',
      renameTitle: 'Gerät umbenennen',
      renameDesc: 'Nur der Anzeigename ändert sich; die Kopplung bleibt bestehen.',
      renameEmpty: 'Der Gerätename darf nicht leer sein',
      revokeConfirm: '„{name}“ entfernen? Das Gerät muss erneut koppeln.',
      via: 'Über',
      noDevices: 'Noch keine Geräte',
      codeLost: 'Sitzung abgelaufen. dsh Web-Oberfläche neu laden.',
      operationFailed: 'Vorgang fehlgeschlagen',
    }

    const ru = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: 'Код сопряжения',
      lockMode: 'Заблокировать',
      lockHintOn: 'Заблокировано: новые устройства не могут подключиться, уже подключённые работают как обычно',
      oneTimeMode: 'Одноразовый',
      fixedMode: 'Постоянный',
      interactionTitle: 'Подтверждения и вопросы',
      interactionDefault: 'По умолчанию',
      interactionDshFirst: 'Сначала DSH',
      interactionDeviceFirst: 'Сначала устройство',
      interactionHintDefault: 'Только в веб-интерфейсе; устройствам ничего не отправляется',
      interactionHintDshFirst: 'Открытый веб-интерфейс отвечает первым',
      interactionHintDeviceFirst: 'Сначала отвечает устройство, которое используется',
      remaining: 'Осталось {time}',
      modify: 'Изменить',
      setPermanentTitle: 'Задать постоянный код',
      setPermanentDesc: 'Введите четыре цифры — они станут постоянным кодом сопряжения.',
      digitsFour: 'четыре цифры',
      digitsNew: 'четыре новые цифры',
      modifyTitle: 'Изменить постоянный код',
      modifyDesc: 'Введите четыре новые цифры; старый код сразу перестанет работать.',
      passwordPlaceholder: 'Четыре цифры',
      passwordInvalid: 'Введите четыре цифры',
      confirm: 'Подтвердить',
      cancel: 'Отмена',
      qrTitle: 'Сканировать или ввести',
      qrFailed: 'Не удалось создать QR-код',
      qrLoading: 'Загрузка QR…',
      qrHint: 'Откройте DSH Hello на телефоне: Подключение → Добавить сервер → Сопряжение плагина → Сканировать QR-код.',
      devices: 'Сопряжённые устройства',
      device: 'Устройство',
      pairedAt: 'Сопряжено',
      lastSeen: 'Последнее подключение',
      actions: 'Действия',
      revoke: 'Удалить',
      rename: 'Переименовать',
      renameTitle: 'Переименовать устройство',
      renameDesc: 'Меняется только отображаемое имя; сопряжение сохраняется.',
      renameEmpty: 'Имя устройства не может быть пустым',
      revokeConfirm: 'Удалить «{name}»? Для повторного подключения потребуется сопряжение.',
      via: 'Через',
      noDevices: 'Устройств пока нет',
      codeLost: 'Сессия истекла. Перезагрузите веб-интерфейс dsh.',
      operationFailed: 'Не удалось выполнить операцию',
    }

    const pt = {
      nav: 'DSH Hello',
      title: 'DSH Hello',
      pairingCode: 'Código de emparelhamento',
      lockMode: 'Bloquear',
      lockHintOn: 'Bloqueado: novos dispositivos não podem emparelhar; os já emparelhados continuam funcionando',
      oneTimeMode: 'Uso único',
      fixedMode: 'Permanente',
      interactionTitle: 'Aprovações e perguntas',
      interactionDefault: 'Padrão',
      interactionDshFirst: 'DSH primeiro',
      interactionDeviceFirst: 'Dispositivo primeiro',
      interactionHintDefault: 'Só na web; nada é enviado aos dispositivos',
      interactionHintDshFirst: 'A interface web responde enquanto está aberta',
      interactionHintDeviceFirst: 'O dispositivo em uso responde primeiro',
      remaining: 'Faltam {time}',
      modify: 'Alterar',
      setPermanentTitle: 'Definir um código permanente',
      setPermanentDesc: 'Digite quatro dígitos para usá-los como código permanente.',
      digitsFour: 'quatro dígitos',
      digitsNew: 'quatro dígitos novos',
      modifyTitle: 'Alterar o código permanente',
      modifyDesc: 'Digite quatro dígitos novos; o código permanente anterior deixa de funcionar imediatamente.',
      passwordPlaceholder: 'Quatro dígitos',
      passwordInvalid: 'Digite quatro dígitos',
      confirm: 'Confirmar',
      cancel: 'Cancelar',
      qrTitle: 'Escanear ou digitar',
      qrFailed: 'Não foi possível gerar o QR code',
      qrLoading: 'Carregando QR…',
      qrHint: 'Abra o DSH Hello no celular, depois Conexão → Adicionar servidor → Emparelhamento por plugin → Escanear o QR code.',
      devices: 'Dispositivos emparelhados',
      device: 'Dispositivo',
      pairedAt: 'Emparelhado',
      lastSeen: 'Última conexão',
      actions: 'Ações',
      revoke: 'Remover',
      rename: 'Renomear',
      renameTitle: 'Renomear dispositivo',
      renameDesc: 'Apenas o nome exibido muda; o emparelhamento continua.',
      renameEmpty: 'O nome do dispositivo não pode ficar vazio',
      revokeConfirm: 'Remover “{name}”? Será necessário emparelhar novamente.',
      via: 'Via',
      noDevices: 'Ainda não há dispositivos',
      codeLost: 'Sessão expirada. Recarregue a interface web do dsh.',
      operationFailed: 'Falha na operação',
    }


    function installStyles() {
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-hello'
      style.textContent = styles
      document.head.append(style)
      return () => style.remove()
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'dsh-hello: admin copy')
        ctx.effect(installStyles, 'dsh-hello: admin styles')

        const t = ctx.locale.bind(NS)

        /** Browser-local date/time for the device table; follows the page language. */
        let deviceTimeFormat
        function formatDeviceTime(value) {
          const date = new Date(value)
          if (Number.isNaN(date.getTime())) return '—'
          try {
            deviceTimeFormat ??= new Intl.DateTimeFormat(
              document.documentElement.lang || navigator.language || undefined,
              { dateStyle: 'medium', timeStyle: 'short' },
            )
            return deviceTimeFormat.format(date)
          } catch {
            return date.toLocaleString()
          }
        }

        function AdminSection() {
          const [data, setData] = React.useState(null)
          const [error, setError] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [now, setNow] = React.useState(Date.now())
          const [dialog, setDialog] = React.useState(null)
          const [password, setPassword] = React.useState('')
          const [dialogError, setDialogError] = React.useState(null)
          const [busyDevice, setBusyDevice] = React.useState(null)
          const [renameTarget, setRenameTarget] = React.useState(null)
          const [renameValue, setRenameValue] = React.useState('')
          const [renameError, setRenameError] = React.useState(null)

          React.useEffect(() => {
            let alive = true
            async function load() {
              try {
                // Use the address the admin page is actually loaded from, not
                // the Host's bind address. This keeps the Settings QR usable on
                // a NATed cloud Host even when --public-url is not set.
                const response = await fetch(BASE + '/admin/data' + adminBaseQuery(), { credentials: 'same-origin', cache: 'no-store' })
                if (!response.ok) throw new Error(t('codeLost'))
                const next = await response.json()
                if (alive) {
                  setData(next)
                  setError(null)
                }
              } catch (failure) {
                if (alive) setError(failure instanceof Error ? failure.message : String(failure))
              }
            }
            void load()
            const timer = setInterval(load, 5000)
            return () => {
              alive = false
              clearInterval(timer)
            }
          }, [t])

          React.useEffect(() => {
            const timer = setInterval(() => setNow(Date.now()), 1000)
            return () => clearInterval(timer)
          }, [])

          async function perform(payload) {
            setBusy(true)
            try {
              const response = await fetch(BASE + '/admin/pair-code' + adminBaseQuery(), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
              return null
            } catch (failure) {
              return failure instanceof Error ? failure.message : String(failure)
            } finally {
              setBusy(false)
            }
          }

          const fixed = data?.fixed === true
          const locked = data?.locked === true
          const interaction = data?.interactionTarget === 'phone-first' || data?.interactionTarget === 'browser-only'
            ? data.interactionTarget
            : 'browser-first'
          const remaining = !fixed && data ? Math.max(0, data.expiresAt - now) : null
          const left = remaining === null
            ? ''
            : `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`

          async function setLocked(next) {
            setBusy(true)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/lock' + adminBaseQuery(), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ locked: next }),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setBusy(false)
            }
          }

          async function setInteractionTarget(target) {
            setBusy(true)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/interaction' + adminBaseQuery(), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ target }),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setBusy(false)
            }
          }

          const openPermanent = () => {
            setPassword('')
            setDialogError(null)
            setDialog('permanent')
          }
          /**
           * One three-way switch: Lock, One-time, Permanent. Unlocking restores
           * whichever code mode was in force, so switching from Lock to another
           * mode continues into that mode's dialog when it needs input.
           */
          const chooseMode = async (next) => {
            if (busy || data === null) return
            if (next === 'lock') {
              if (!locked) await setLocked(true)
              return
            }
            if (locked) await setLocked(false)
            // Picking One-time drops the permanent code on the spot: the switch
            // states the intent, so it must not ask a second time.
            if (next === 'one-time' && fixed) { await perform({ action: 'auto' }); return }
            if (next === 'permanent' && !fixed) openPermanent()
          }
          const confirmPermanent = async () => {
            const code = password.trim()
            if (!/^\d{4}$/.test(code)) {
              setDialogError(t('passwordInvalid'))
              return
            }
            const failure = await perform({ action: 'fixed', code })
            if (failure !== null) {
              setDialogError(failure)
              return
            }
            setDialog(null)
            setPassword('')
          }

          const revokeDevice = async (device) => {
            const name = device.deviceName || String(device.deviceId || '').slice(0, 12)
            if (!window.confirm(t('revokeConfirm', { name }))) return
            setBusyDevice(device.deviceId)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/devices/' + encodeURIComponent(device.deviceId) + adminBaseQuery(), {
                method: 'DELETE',
                credentials: 'same-origin',
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setBusyDevice(null)
            }
          }

          const openRename = (device) => {
            setRenameValue(device.deviceName || '')
            setRenameError(null)
            setRenameTarget(device)
          }

          const confirmRename = async () => {
            if (renameTarget === null) return
            const name = renameValue.trim()
            if (name.length === 0) {
              setRenameError(t('renameEmpty'))
              return
            }
            setBusyDevice(renameTarget.deviceId)
            setRenameError(null)
            setError(null)
            try {
              const response = await fetch(BASE + '/admin/devices/' + encodeURIComponent(renameTarget.deviceId) + adminBaseQuery(), {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name }),
              })
              if (!response.ok) {
                const body = await response.json().catch(() => null)
                throw new Error(body?.error?.message || t('operationFailed'))
              }
              setData(await response.json())
              setRenameTarget(null)
            } catch (failure) {
              setRenameError(failure instanceof Error ? failure.message : String(failure))
            } finally {
              setBusyDevice(null)
            }
          }

          const devices = Array.isArray(data?.devices) ? data.devices : []

          return h('section', { className: 'dd-page' },
            h('header', { className: 'dd-head' },
              h('h2', { className: 'dd-title' }, t('title'))),
            error === null ? null : h('p', { className: 'dd-error' }, error),

            h('div', { className: 'dd-row dd-rowTop dd-rowHead' },
              h('div', { className: 'dd-rowText' },
                h('span', { className: 'dd-label' }, t('pairingCode')),
              ),
              h('div', { className: 'dd-control' },
                h('div', { className: 'dd-segment' },
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (locked ? ' is-active' : ''),
                    disabled: busy || data === null,
                    onClick: () => { void chooseMode('lock') },
                  }, t('lockMode')),
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (!locked && !fixed ? ' is-active' : ''),
                    disabled: busy || data === null,
                    onClick: () => { void chooseMode('one-time') },
                  }, t('oneTimeMode')),
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (!locked && fixed ? ' is-active' : ''),
                    disabled: busy || data === null,
                    onClick: () => { void chooseMode('permanent') },
                  }, t('fixedMode')),
                ),
              ),
            ),

            locked
              ? h('div', { className: 'dd-row' },
                h('span', { className: 'dd-desc' }, t('lockHintOn')),
              )
              : [
                h('div', { className: 'dd-row', key: 'code' },
                  h('span', { className: 'dd-code' }, data?.formatted ?? '…'),
                  h('div', { className: 'dd-control' },
                    fixed
                      ? h(Button, {
                        variant: 'primary',
                        size: 'sm',
                        disabled: busy,
                        onClick: openPermanent,
                      }, t('modify'))
                      : h('span', { className: 'dd-countdown' }, left.length > 0 ? t('remaining', { time: left }) : ''),
                  ),
                ),
                h('div', { className: 'dd-block', key: 'qr' },
                  h('span', { className: 'dd-label' }, t('qrTitle')),
                  typeof data?.qrSvg === 'string' && data.qrSvg.trimStart().startsWith('<svg')
                    ? h('div', { className: 'dd-qr-img', dangerouslySetInnerHTML: { __html: data.qrSvg } })
                    : h('div', { className: 'dd-qr-failed' },
                      h('span', { className: 'dd-desc' }, t('qrFailed')),
                      typeof data?.qrError === 'string' && data.qrError.length > 0
                        ? h('span', { className: 'dd-qr-reason' }, data.qrError)
                        : null),
                  h('span', { className: 'dd-desc' }, t('qrHint')),
                ),
              ],

            h('div', { className: 'dd-row dd-rowTop' },
              h('div', { className: 'dd-rowText' },
                h('span', { className: 'dd-label' }, t('interactionTitle')),
                h('span', { className: 'dd-desc dd-oneLine' },
                  interaction === 'phone-first'
                    ? t('interactionHintDeviceFirst')
                    : interaction === 'browser-first'
                      ? t('interactionHintDshFirst')
                      : t('interactionHintDefault')),
              ),
              h('div', { className: 'dd-control' },
                h('div', { className: 'dd-segment' },
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (interaction === 'browser-only' ? ' is-active' : ''),
                    disabled: busy || data === null,
                    onClick: () => { void setInteractionTarget('browser-only') },
                  }, t('interactionDefault')),
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (interaction === 'browser-first' ? ' is-active' : ''),
                    disabled: busy || data === null,
                    onClick: () => { void setInteractionTarget('browser-first') },
                  }, t('interactionDshFirst')),
                  h('button', {
                    type: 'button',
                    className: 'dd-segmentButton' + (interaction === 'phone-first' ? ' is-active' : ''),
                    disabled: busy || data === null,
                    onClick: () => { void setInteractionTarget('phone-first') },
                  }, t('interactionDeviceFirst')),
                ),
              ),
            ),

            h('div', { className: 'dd-block' },
              h('span', { className: 'dd-label' }, t('devices')),
              h('div', { className: 'dd-devices' },
                devices.length === 0
                  ? h('div', { className: 'dd-desc' }, t('noDevices'))
                  : devices.map(device => h('div', { className: 'dd-device', key: String(device.deviceId) },
                    h('div', { className: 'dd-deviceInfo' },
                      h('div', { className: 'dd-deviceNameRow' },
                        h('span', { className: 'dd-deviceName' }, device.deviceName || '—'),
                        h('button', {
                          type: 'button',
                          className: 'dd-rename',
                          disabled: busyDevice === device.deviceId,
                          onClick: () => { openRename(device) },
                        }, t('rename')),
                      ),
                      h('span', { className: 'dd-deviceMeta' },
                        `${device.platform || 'unknown'} · ${device.appVersion || '—'}`),
                    ),
                    h('div', { className: 'dd-deviceSide' },
                      h('div', { className: 'dd-deviceTimes' },
                        h('span', { className: 'dd-deviceTime' }, `${t('lastSeen')} ${formatDeviceTime(device.lastSeenAt)}`),
                        h('span', { className: 'dd-deviceTime' }, `${t('pairedAt')} ${formatDeviceTime(device.pairedAt)}`),
                      ),
                      h('div', { className: 'dd-deviceAction' },
                        h(Button, {
                          variant: 'ghost',
                          size: 'sm',
                          disabled: busyDevice === device.deviceId,
                          onClick: () => { void revokeDevice(device) },
                        }, t('revoke'))),
                    ),
                  )),
              ),
            ),

            dialog === null ? null : h('div', {
              className: 'dd-modalBackdrop',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) setDialog(null)
              },
            },
            h('div', { className: 'dd-modal', role: 'dialog', 'aria-modal': 'true' },
              h('h3', { className: 'dd-modalTitle' },
                fixed ? t('modifyTitle') : t('setPermanentTitle')),
              h('p', { className: 'dd-desc' },
                emphasize(fixed ? t('modifyDesc') : t('setPermanentDesc'), fixed ? t('digitsNew') : t('digitsFour'))),
              h(Input, {
                className: 'dd-modalInput',
                value: password,
                placeholder: t('passwordPlaceholder'),
                autoFocus: true,
                autoComplete: 'off',
                onChange: event => setPassword(event.target.value.replace(/\D/g, '').slice(0, 4)),
              }),
              dialogError === null ? null : h('p', { className: 'dd-error' }, dialogError),
              h('div', { className: 'dd-modalActions' },
                h(Button, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => setDialog(null),
                }, t('cancel')),
                h(Button, {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => { void confirmPermanent() },
                }, t('confirm')),
              ),
            )),
            renameTarget === null ? null : h('div', {
              className: 'dd-modalBackdrop',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) setRenameTarget(null)
              },
            },
            h('div', { className: 'dd-modal', role: 'dialog', 'aria-modal': 'true' },
              h('h3', { className: 'dd-modalTitle' }, t('renameTitle')),
              h('p', { className: 'dd-desc' }, t('renameDesc')),
              h(Input, {
                className: 'dd-modalInput',
                value: renameValue,
                placeholder: t('renameTitle'),
                autoFocus: true,
                autoComplete: 'off',
                onChange: event => setRenameValue(event.target.value.slice(0, 120)),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void confirmRename()
                },
              }),
              renameError === null ? null : h('p', { className: 'dd-error' }, renameError),
              h('div', { className: 'dd-modalActions' },
                h(Button, {
                  variant: 'ghost',
                  size: 'sm',
                  disabled: busyDevice === renameTarget.deviceId,
                  onClick: () => setRenameTarget(null),
                }, t('cancel')),
                h(Button, {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busyDevice === renameTarget.deviceId,
                  onClick: () => { void confirmRename() },
                }, t('confirm')),
              ),
            )),
          )
        }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-hello',
          order: 5,
          label: () => t('nav'),
        }, AdminSection))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'dsh-hello',
        }, ({ size = 16, active }) => h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M3 2.5h7v11H3z',
          fill: active ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('path', {
          d: 'M10 3.5l3 1v9l-3-1z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }))))
      },
    }
  },
})
