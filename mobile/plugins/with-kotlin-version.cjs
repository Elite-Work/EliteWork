const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Expo SDK 52's Compose compiler requires Kotlin 1.9.25, while the generated
 * template still defaults to 1.9.24. Keep the native project compatible with
 * the Expo Modules Core version resolved by the lockfile.
 */
module.exports = function withKotlinVersion(config) {
  return withProjectBuildGradle(config, (project) => {
    if (project.modResults.language !== 'groovy') {
      return project;
    }

    project.modResults.contents = project.modResults.contents.replace(
      /kotlinVersion = findProperty\('android\.kotlinVersion'\) \?: '1\.9\.24'/,
      "kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.25'",
    );

    return project;
  });
};
