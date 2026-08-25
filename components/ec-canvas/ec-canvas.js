var WxCanvas = require('./wx-canvas');

function compareVersion(v1, v2) {
  v1 = v1.split('.');
  v2 = v2.split('.');
  var len = Math.max(v1.length, v2.length);
  while (v1.length < len) { v1.push('0'); }
  while (v2.length < len) { v2.push('0'); }
  for (var i = 0; i < len; i++) {
    var num1 = parseInt(v1[i]);
    var num2 = parseInt(v2[i]);
    if (num1 > num2) return 1;
    else if (num1 < num2) return -1;
  }
  return 0;
}

// 兼容性封装：优先使用新分片 API，回退到 getSystemInfoSync（避免 deprecated 警告）
function getSDKVersion() {
  try {
    if (wx.getAppBaseInfo) return wx.getAppBaseInfo().SDKVersion || '0.0.0';
  } catch (e) {}
  try {
    if (wx.getSystemInfoSync) return wx.getSystemInfoSync().SDKVersion || '0.0.0';
  } catch (e) {}
  return '0.0.0';
}

function getPixelRatio() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo().pixelRatio || 1;
  } catch (e) {}
  try {
    if (wx.getDeviceInfo) return wx.getDeviceInfo().pixelRatio || 1;
  } catch (e) {}
  try {
    if (wx.getSystemInfoSync) return wx.getSystemInfoSync().pixelRatio || 1;
  } catch (e) {}
  return 1;
}

Component({
  properties: {
    canvasId: {
      type: String,
      value: 'ec-canvas'
    },
    echarts: {
      type: Object
    },
    ec: {
      type: Object
    }
  },

  ready: function () {
    if (!this.data.echarts) {
      console.warn('组件需要传入 echarts');
      return;
    }

    // 禁用 progressive（小程序 drawImage 不支持 DOM 参数）
    this.data.echarts.registerPreprocessor(function (option) {
      if (option && option.series) {
        if (option.series.length > 0) {
          option.series.forEach(function (series) {
            series.progressive = 0;
          });
        } else if (typeof option.series === 'object') {
          option.series.progressive = 0;
        }
      }
    });

    if (!this.data.ec) {
      console.warn('组件需绑定 ec 变量');
      return;
    }

    if (!this.data.ec.lazyLoad) {
      this.init();
    }
  },

  methods: {
    init: function (callback) {
      // 防止 ready 生命周期与 canvas bindinit 事件重复触发
      if (this._initialized) return;
      var version = getSDKVersion();
      if (compareVersion(version, '2.9.0') < 0) {
        console.error('微信基础库版本过低，需大于等于 2.9.0 以支持 Canvas 2D 同层渲染');
        return;
      }
      this.initByNewWay(callback);
    },

    initByNewWay: function (callback) {
      var _this2 = this;
      var query = wx.createSelectorQuery().in(this);
      query.select('.ec-canvas').fields({ node: true, size: true }).exec(function (res) {
        if (!res || !res[0] || !res[0].node) {
          // ready 阶段 canvas 节点可能尚未就绪，等待 bindinit 事件再次触发
          return;
        }
        _this2._initialized = true;
        var canvasNode = res[0].node;
        _this2.canvasNode = canvasNode;

        var canvasDpr = getPixelRatio();
        var ctx = canvasNode.getContext('2d');

        var canvas = new WxCanvas(ctx, _this2.data.canvasId, true, canvasNode);
        _this2.data.echarts.setCanvasCreator(function () {
          return canvas;
        });

        if (typeof callback === 'function') {
          _this2.chart = callback(canvas, res[0].width, res[0].height, canvasDpr);
        } else if (_this2.data.ec && typeof _this2.data.ec.onInit === 'function') {
          _this2.chart = _this2.data.ec.onInit(canvas, res[0].width, res[0].height, canvasDpr);
        } else {
          _this2.triggerEvent('init', {
            canvas: canvas,
            width: res[0].width,
            height: res[0].height,
            dpr: canvasDpr
          });
        }
      });
    },

    canvasToTempFilePath: function (opt) {
      var query = wx.createSelectorQuery().in(this);
      query.select('.ec-canvas').fields({ node: true, size: true }).exec(function (res) {
        opt.canvas = res[0].node;
        wx.canvasToTempFilePath(opt);
      });
    },

    touchStart: function (e) {
      if (this.chart && e.touches.length > 0) {
        var touch = e.touches[0];
        var handler = this.chart.getZr().handler;
        handler.dispatch('mousedown', {
          zrX: touch.x,
          zrY: touch.y,
          preventDefault: function () {},
          stopPropagation: function () {}
        });
        handler.dispatch('mousemove', {
          zrX: touch.x,
          zrY: touch.y,
          preventDefault: function () {},
          stopPropagation: function () {}
        });
        handler.processGesture(wrapTouch(e), 'start');
      }
    },

    touchMove: function (e) {
      if (this.chart && e.touches.length > 0) {
        var touch = e.touches[0];
        var handler = this.chart.getZr().handler;
        handler.dispatch('mousemove', {
          zrX: touch.x,
          zrY: touch.y,
          preventDefault: function () {},
          stopPropagation: function () {}
        });
        handler.processGesture(wrapTouch(e), 'change');
      }
    },

    touchEnd: function (e) {
      if (this.chart) {
        var touch = e.changedTouches ? e.changedTouches[0] : {};
        var handler = this.chart.getZr().handler;
        handler.dispatch('mouseup', {
          zrX: touch.x,
          zrY: touch.y,
          preventDefault: function () {},
          stopPropagation: function () {}
        });
        handler.dispatch('click', {
          zrX: touch.x,
          zrY: touch.y,
          preventDefault: function () {},
          stopPropagation: function () {}
        });
        handler.processGesture(wrapTouch(e), 'end');
      }
    }
  }
});

function wrapTouch(event) {
  for (var i = 0; i < event.touches.length; ++i) {
    var touch = event.touches[i];
    touch.offsetX = touch.x;
    touch.offsetY = touch.y;
    touch.preventDefault = function () {};
    touch.stopPropagation = function () {};
  }
  if (event.changedTouches) {
    for (var j = 0; j < event.changedTouches.length; ++j) {
      var ct = event.changedTouches[j];
      ct.offsetX = ct.x;
      ct.offsetY = ct.y;
      ct.preventDefault = function () {};
      ct.stopPropagation = function () {};
    }
  }
  event.preventDefault = function () {};
  event.stopPropagation = function () {};
  return event;
}
