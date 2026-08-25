/**
 * WxCanvas - 微信小程序 Canvas 适配器
 * 将 echarts/zrender 的 DOM API 调用映射到微信小程序 Canvas API
 */
function WxCanvas(ctx, canvasId, isNew, canvasNode) {
  this.ctx = ctx;
  this.canvasId = canvasId;
  this.chart = null;
  this.isNew = isNew;
  if (isNew) {
    this.canvasNode = canvasNode;
  } else {
    this._initStyle(ctx);
  }
  this._initEvent();
}

WxCanvas.prototype.getContext = function (contextType) {
  if (contextType === '2d') {
    return this.ctx;
  }
};

WxCanvas.prototype.setChart = function (chart) {
  this.chart = chart;
};

// ===== 关键：DOM API polyfill，让 zrender 不报错 =====
WxCanvas.prototype.addEventListener = function () {};
WxCanvas.prototype.removeEventListener = function () {};
WxCanvas.prototype.attachEvent = function () {};
WxCanvas.prototype.detachEvent = function () {};
WxCanvas.prototype.preventDefault = function () {};
WxCanvas.prototype.stopPropagation = function () {};

// ===== 阻止 zrender 创建额外的 DOM 事件处理器 =====
// 当 zrender 调用 setCanvasCreator 后，它会在返回的 canvas 上调用 addEventListener
// 这里提供空实现来避免 "is not a function" 错误

WxCanvas.prototype._initStyle = function (ctx) {
  var styles = [
    'fillStyle', 'strokeStyle', 'globalAlpha',
    'textAlign', 'textBaseAlign', 'shadow', 'lineWidth',
    'lineCap', 'lineJoin', 'lineDash', 'miterLimit', 'fontSize'
  ];

  styles.forEach(function (style) {
    Object.defineProperty(ctx, style, {
      set: function (value) {
        if (style !== 'fillStyle' && style !== 'strokeStyle'
          || value !== 'none' && value !== null
        ) {
          ctx['set' + style.charAt(0).toUpperCase() + style.slice(1)](value);
        }
      }
    });
  });

  ctx.createRadialGradient = function () {
    return ctx.createCircularGradient(arguments);
  };
};

WxCanvas.prototype._initEvent = function () {
  var _this = this;
  this.event = {};
  var eventNames = [
    { wxName: 'touchStart', ecName: 'mousedown' },
    { wxName: 'touchMove', ecName: 'mousemove' },
    { wxName: 'touchEnd', ecName: 'mouseup' },
    { wxName: 'touchEnd', ecName: 'click' }
  ];

  eventNames.forEach(function (name) {
    _this.event[name.wxName] = function (e) {
      var touch = e.touches[0];
      _this.chart.getZr().handler.dispatch(name.ecName, {
        zrX: name.wxName === 'tap' ? touch.clientX : touch.x,
        zrY: name.wxName === 'tap' ? touch.clientY : touch.y
      });
    };
  });
};

Object.defineProperty(WxCanvas.prototype, 'width', {
  set: function (w) {
    if (this.canvasNode) this.canvasNode.width = w;
  },
  get: function () {
    if (this.canvasNode) return this.canvasNode.width;
    return 0;
  }
});

Object.defineProperty(WxCanvas.prototype, 'height', {
  set: function (h) {
    if (this.canvasNode) this.canvasNode.height = h;
  },
  get: function () {
    if (this.canvasNode) return this.canvasNode.height;
    return 0;
  }
});

module.exports = WxCanvas;
