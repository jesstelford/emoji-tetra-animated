const execa = require('execa');
const gifsicle = require('gifsicle');

module.export = () => {
  return execa
    .shell('gifski -o anim.gif --fps 3 --quality=100 screens/*.png', { stdio: 'inherit' })
    .then(result => {
      console.log('gifski:', result);
      return execa
        .shell('gifsicle -b -O3 --colors 256 anim.gif', { stdio: 'inherit' })
    })
    .then(result => {
      console.log('gifsicle:', result);
    })
    .catch(error => {
      console.error('Error', error);
    });
}
