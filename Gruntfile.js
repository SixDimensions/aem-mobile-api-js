module.exports = function(grunt) {
  grunt.initConfig({
    'gh-pages': {
      options: {
        base: 'docs'
      },
      src: ['**']
    },
    jsdoc: {
      dist: {
        options: {
          destination: 'docs',
          configure: 'jsdoc.conf'
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-gh-pages');
  grunt.loadNpmTasks('grunt-jsdoc');
  grunt.registerTask('default', ['jsdoc', 'gh-pages']);
};
