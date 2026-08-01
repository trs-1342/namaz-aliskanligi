const fs = require('node:fs');
const path = require('node:path');

const MARKER = '@withAndroidAlarm-fullscreen-v4';

function patchExpoNotificationBuilder(builderPath) {
  if (!fs.existsSync(builderPath)) {
    throw new Error(`ExpoNotificationBuilder.kt not found: ${builderPath}`);
  }

  const source = fs.readFileSync(builderPath, 'utf8');
  if (source.includes(MARKER)) return false;

  const target = `    builder.setContentIntent(
      createNotificationResponseIntent(
        context,
        notification,
        defaultAction
      )
    )`;
  if (!source.includes(target)) {
    throw new Error('expo-notifications changed: setContentIntent anchor was not found');
  }

  const insertion = `

    // ${MARKER}
    if (content.body?.optBoolean("isAlarm", false) == true) {
      context.getSharedPreferences("AlarmWindow", android.content.Context.MODE_PRIVATE)
        .edit()
        .putBoolean("alarmActive", true)
        .putLong("alarmFiredAt", System.currentTimeMillis())
        .apply()

      builder.setFullScreenIntent(
        createNotificationResponseIntent(context, notification, defaultAction),
        true
      )
    }`;

  fs.writeFileSync(builderPath, source.replace(target, target + insertion), 'utf8');
  return true;
}

function defaultBuilderPath(projectRoot = process.cwd()) {
  const packageRoot = path.dirname(require.resolve('expo-notifications/package.json', { paths: [projectRoot] }));
  return path.join(
    packageRoot,
    'android/src/main/java/expo/modules/notifications/notifications/presentation/builders/ExpoNotificationBuilder.kt'
  );
}

if (require.main === module) {
  const changed = patchExpoNotificationBuilder(defaultBuilderPath());
  console.log(changed ? 'Android alarm patch applied.' : 'Android alarm patch already applied.');
}

module.exports = { defaultBuilderPath, patchExpoNotificationBuilder };
