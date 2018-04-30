const fs = require('fs');
const execa = require('execa');
const gifsicle = require('gifsicle');

const fileSize = (path) => {
  const { size } = fs.statSync(path);
  const fileSizeInMegabytes = size / 1000000;
  return `${fileSizeInMegabytes.toFixed(2)}MB`;
};

module.exports = (spinner) => {
  spinner.start('Generating anim.gif');
  return execa
    .shell('gifski -o anim.gif --fps 3 --quality=100 screens/*.png')
    .then((result) => {
      spinner.succeed(`anim.gif generated (${fileSize('anim.gif')})`).start('Optimizing anim.gif');
      return execa.shell(`${gifsicle} -b -O3 --colors 256 anim.gif`);
    })
    .then((result) => {
      spinner.succeed(`anim.gif optimized (${fileSize('anim.gif')})`);
    });
};
