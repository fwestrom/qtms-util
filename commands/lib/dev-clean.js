module.exports = function clean(getServices, _, io, logging, spawner) {
    return function() {
        var log = logging.getLogger('dev.clean');
        return rmDir(builddir);

        function rmDir(dir) {
            return fs.statAsync(dir)
                .then(function(stat) {
                    if (stat.isDirectory()) {
                        log.info('Removing directory %s', dir);
                        return fs.rmdirAsync(dir);
                    }
                })
                .catch(function(error) {
                    if (error.code !== 'ENOENT') {
                        log.warn('Failed to remove directory %s; error:', dir, error);
                    }
                });
        }
    };
};
