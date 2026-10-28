/* eslint-disable @typescript-eslint/no-require-imports */
const { withGradleProperties, withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Keep the generated Android project compatible with the Expo Modules Core
 * version resolved by the lockfile.
 */
module.exports = function withKotlinVersion(config) {
  config = withGradleProperties(config, (project) => {
    const property = project.modResults.find(
      (item) => item.type === 'property' && item.key === 'android.kotlinVersion',
    );

    if (property) {
      property.value = '1.9.25';
    } else {
      project.modResults.push({
        type: 'property',
        key: 'android.kotlinVersion',
        value: '1.9.25',
      });
    }

    return project;
  });

  return withProjectBuildGradle(config, (project) => {
    if (project.modResults.language !== 'groovy') {
      return project;
    }

    let contents = project.modResults.contents.replace(
      /kotlinVersion = findProperty\('android\.kotlinVersion'\) \?: '1\.9\.24'/,
      "kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.25'",
    );

    project.modResults.contents = contents;

    return project;
  });
};
