var async = require('async');
var _ = require('lodash');

module.exports = {

  improve: 'apostrophe-pieces',

  construct: function(self, options) {

    self.addRestApiRoutes = function() {
      var restApi = self.apos.modules['apostrophe-headless'];
      if ((!options.restApi) || (options.restApi.enabled === false)) {
        return;
      }
      var baseEndpoint = restApi.endpoint;
      var endpoint = baseEndpoint + '/' + (options.restApi.name || self.__meta.name);

      // GET many
      self.apos.app.get(endpoint, function(req, res) {
        var cursor = self.findForRestApi(req);
        var result = {};
        return async.series([ countPieces, findPieces, renderPieces ], function(err) {
          if (err) {
            return res.status(500).send({ error: 'error' });
          }
          return res.send(result);
        });

        function countPieces(callback) {
          return cursor.toCount(function(err, count) {
            if (err) {
              return callback(err);
            }
            result.total = count;
            result.pages = cursor.get('totalPages');
            result.perPage = cursor.get('perPage');
            return callback(null);
          });
        }

        function findPieces(callback) {
          return cursor.toArray(function(err, pieces) {
            if (err) {
              return callback(err);
            }
            // Attach `_url` and `_urls` properties
            self.apos.attachments.all(pieces, { annotate: true });
            result.results = pieces;
            return callback(null);
          });
        }

        function renderPieces(callback) {
          return async.eachSeries(result.results, function(piece, callback) {
            var restApi = self.apos.modules['apostrophe-headless'];
            return restApi.apiRender(req, self, piece, 'piece', callback);
          }, callback);
        }

      });

      // GET one
      self.apos.app.get(endpoint + '/:id', function(req, res) {
        var id = self.apos.launder.id(req.params.id);
        if (!id) {
          return res.status(400).send({ error: 'bad request' });
        }
        var piece;
        return async.series([ find, render ], function(err) {
          if (err) {
            if (err === 'notfound') {
              return res.status(404).send({ error: 'notfound' });
            } else {
              console.error(err);
              return res.status(500).send({ error: 'error' });
            }
          }
          return res.send(piece);
        });
        function find(callback) {
          return self.findForRestApi(req).and({ _id: id }).toObject(function(err, _piece) {
            if (err) {
              return callback('error');
            }
            if (!_piece) {
              return callback('notfound');
            }
            piece = _piece;
            // Attach `_url` and `_urls` properties
            self.apos.attachments.all(piece, { annotate: true });
            return callback(null);
          });
        }
        function render(callback) {
          var restApi = self.apos.modules['apostrophe-headless'];
          return restApi.apiRender(req, self, piece, 'piece', callback);
        }
      });

      // POST one
      self.apos.app.post(endpoint, function(req, res) {
        return self.convertInsertAndRefresh(req, function(req, res, err, piece) {
          if (err) {
            return res.status(500).send({ error: 'error' });
          }
          return res.send(piece);
        });
      });

      // UPDATE one
      self.apos.app.put(endpoint + '/:id', function(req, res) {
        var id = self.apos.launder.id(req.params.id);

        return self.findForEditing(req, { _id: id })
          .toObject(function(err, _piece) {
            if (err) {
              return res.status(500).send({ error: 'error' });
            }
            if (!_piece) {
              return res.status(404).send({ error: 'notfound' });
            }
            req.piece = _piece;
            return self.convertUpdateAndRefresh(req, function(req, res, err, piece) {
              if (err) {
                return res.status(500).send({ error: 'error' });
              }
              return res.send(piece);
            });
          }
        );

      });

      // DELETE one
      self.apos.app.delete(endpoint + '/:id', function(req, res) {
        var id = self.apos.launder.id(req.params.id);
        return async.series({
          before: function(callback) {
            return self.beforeTrash(req, id, callback);
          },
          trash: function(callback) {
            return self.trash(req, id, callback);
          },
          after: function(callback) {
            return self.afterTrash(req, id, callback)
          }
        }, function(err) {
          if (err) {
            return res.status(500).send({ error: 'error' });
          }
          return res.send({});
        });
      });

    };

    self.findForRestApi = function(req) {
      var which = 'public';
      if (self.apos.permissions.can(req, 'edit-' + self.name)) {
        which = 'manage';
      }
      var cursor = self.find(req, {})
        .safeFilters(options.restApi.safeFilters || [])
        .queryToFilters(req.query, which);

      var perPage = cursor.get('perPage');
      var maxPerPage = options.restApi.maxPerPage || 50;
      if ((!perPage) || (perPage > maxPerPage)) {
        cursor.perPage(maxPerPage);
      }
      return cursor;
    };

    self.modulesReady = function() {
      var restApi = self.apos.modules['apostrophe-headless'];
      self.addRestApiRoutes();
      restApi.registerModule(self);
    };
  }
};
