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
      return rp(params).then((res) => {
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
      const responses = [];
      for (let i = 0; i < requests.length; i++) {
        responses.push(self.request(requests[i].method, requests[i].url, requests[i].options));
      }
      return responses;
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
      locals = locals || {};

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
      with (this) {
        return co(function *() {
          ${source}
          return __output.join("");
        }.bind(this)).catch ((e) => {
          rethrow(e, __lines, __filename, __line);
        });
      }`;

      // 禁止
      Object.keys(GLOBAL).forEach((key) => {
        locals[key] = undefined;
      });

      // おまけ
      locals.eval = undefined;
      locals.Function = undefined;

      const fn = new Function('redirect, request, requests, includeTemplate, co, escapeFn, rethrow', compileSource); // eslint-disable-line no-new-func
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
      return fn.call(locals, self.redirect, self.request, self.requests, self.includeTemplate, co, utils.escapeXML, rethrow);
    };
  }
}();
