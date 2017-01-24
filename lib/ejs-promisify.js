'use strict';

const co = require('co');
const ejs = require('./ejs');
const utils = require('./utils');
const rp = require('request-promise');

module.exports = new class {
  constructor() {
    const self = this;
    this.locals = {};
    /*
    [リダイレクト]
    redirect("URL");
    */
    this.redirect = (location) => {
      return new Promise((resolve, reject) => {
        const error = new Error(location);
        error.name = 'location';
        return reject(error);
      });
    };

    /*
    [リクエスト]
    var response = yield request("メソッド", "URL", {
      headers:{"キー":"値"},
      query:{"キー":"値"},
      body:{"キー":"値"},
      timeout:3000
    });
    */
    this.request = (method, uri, options) => {
      options = options || {};
      return co(function * () {
        const headers = {};
        Object.keys(options.headers || {}).forEach((key) => {
          headers[key.toLowerCase()] = options.headers[key];
        });
        const params = {
          method: method,
          uri: uri,
          qs: options.query,
          headers: headers,
          transform: (body, response, resolveWithFullResponse) => {
            let _body = body;
            if (response.headers['content-type'] === 'application/json') {
              _body = JSON.parse(_body);
            }
            return {body: _body, headers: response.headers};
          }
        };
        if (headers['content-type'] === 'application/x-www-form-urlencoded') {
          params.form = options.body;
        } else if (headers['content-type'] === 'application/json') {
          params.json = true;
          params.body = options.body;
        } else {
          params.body = options.body;
        }
        if (options.timeout) {
          params.timeout = options.timeout;
        }
        const res = yield rp(params);
        if (res.headers['content-type'].indexOf('application/json') !== -1) {
          res.body = JSON.parse(res.body);
        }
        return res.body;
      });
    };

    /*
    [リダイレクト並列]
    var responses = yield requests([{method:"メソッド", url:"URL", options:{
      headers:{"キー":"値"},
      query:{"キー":"値"},
      body:{"キー":"値"},
      timeout:3000
    }}]);
    */
    this.requests = (requests) => {
      return co(function * () {
        const responses = [];
        for (let i = 0; i < requests.length; i++) {
          responses.push(self.request(requests[i].method, requests[i].url, requests[i].options));
        }
        return yield responses;
      });
    };

    /*
    [インクルード]
    yield includeTemplate("screen_header_ejs || screen_footer_ejs");
    */
    this.includeTemplate = (name) => {
      const template = self.locals.templates[name];
      return self.render(template, self.locals, {});
    };

    // コンパイルソース取得
    this.render = (template, locals, opts) => {
      self.locals = locals;

      if (!opts.context) {
        opts.context = opts.scope;
      }
      delete opts.scope;
      const templ = new ejs.Template(template, opts);

      try {
        templ.generateSource();
      } catch (e) {
        return Promise.reject(new SyntaxError(e.message));
      }
      const source = templ.source;

      const compileSource = `
      var __line = 1;
      var __lines = ${JSON.stringify(templ.templateText)};
      var __filename;
      var __output = [], __append = __output.push.bind(__output);
      with (locals || {}) {
        return co(function *() {
          ${source}
          return __output.join("");
        }).catch ((e) => {
          rethrow(e, __lines, __filename, __line);
        });
      }`;

      // 関数追加
      locals.request = self.request;
      locals.redirect = self.redirect;
      locals.requests = self.requests;
      locals.includeTemplate = self.includeTemplate;
      locals.co = co;
      const fn = new Function('locals, escapeFn, include, rethrow', compileSource); // eslint-disable-line no-new-func
      const include = (path, includeData) => {
        let d = utils.shallowCopy({}, locals);
        if (includeData) {
          d = utils.shallowCopy(d, includeData);
        }
        opts.filename = __dirname;
        return ejs.includeFile(path, opts)(d);
      };
      const rethrow = (err, str, flnm, lineno) => {
        const lines = str.split('\n');
        const start = Math.max(lineno - 3, 0);
        const end = Math.min(lines.length, lineno + 3);
        const filename = utils.escapeXML(flnm);
        // Error context
        const context = lines.slice(start, end).map((line, i) => {
          const curr = i + start + 1;
          return `${(curr === lineno ? ' >> ' : '    ')}${curr}| ${line}`;
        }).join('\n');

        // Alter exception message
        err.path = filename;
        // err.message = `${(filename || 'ejs')}:${lineno}\n${context}\n\n${err.message}`;
        err.lineNumber = lineno;
        err.description = `${(filename || 'ejs')}:${lineno}\n${context}`;
        throw err;
      };

//try {
      return fn.apply({}, [
        locals, utils.escapeXML,
        include, rethrow
      ]); /*.catch((e) => {
        console.log("message", e.message);
        console.log("fileName", e.fileName);
        console.log("lineNumber", e.lineNumber);
        console.log("columnNumber", e.columnNumber);
        console.log("number", e.number);
        console.log("description", e.description);
        console.log("stack", e.stack);
        return Promise.reject(new ReferenceError(e.message));
      });

} catch(e) {
        console.log("message", e.message);
        console.log("fileName", e.fileName);
        console.log("lineNumber", e.lineNumber);
        console.log("columnNumber", e.columnNumber);
        console.log("number", e.number);
        console.log("description", e.description);
        console.log("stack", e.stack);
        return Promise.reject(new ReferenceError(e.message));
}
*/
    };
  }
}();
