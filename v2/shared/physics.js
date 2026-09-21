/* Маленький физический мир для мини-игр: падение, отскок, куча из тел.
   Тела — прямоугольники без вращения в расчётах (угол только рисуется),
   этого достаточно для кубиков с буквами и ярлыков вещей, зато стек
   получается устойчивым и не дрожит.

   Сторонние движки не годятся: страница должна работать офлайн с GitHub Pages. */

(function (global) {
  'use strict';

  const SLEEP_SPEED = 14;     // px/с — ниже этого тело считается остановившимся
  const SLEEP_FRAMES = 10;
  const BOUNCE_FROM = 200;    // px/с — ниже удара нет, только укладка
  const SLOP = 0.4;           // допустимое проникновение, гасит дрожание
  const CORRECTION = 0.7;
  const ITERATIONS = 4;

  class Body {
    constructor(opts) {
      this.x = opts.x;
      this.y = opts.y;
      this.w = opts.w;
      this.h = opts.h;
      this.vx = opts.vx || 0;
      this.vy = opts.vy || 0;
      this.angle = opts.angle || 0;
      this.va = opts.va || 0;
      this.restitution = opts.restitution ?? 0.32;
      this.friction = opts.friction ?? 0.78;
      this.node = opts.node || null;
      this.data = opts.data || null;
      this.sleeping = false;
      this.still = 0;
      this.onFloor = false;
    }

    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }

    wake() { this.sleeping = false; this.still = 0; }

    push(vx, vy, va) {
      this.vx += vx;
      this.vy += vy;
      this.va += va || 0;
      this.wake();
    }
  }

  class World {
    constructor(opts = {}) {
      this.width = opts.width || 320;
      this.height = opts.height || 480;
      this.gravity = opts.gravity || 2600;
      this.wallBounce = opts.wallBounce ?? 0.35;
      this.bodies = [];
    }

    add(body) { this.bodies.push(body); return body; }

    remove(body) {
      const i = this.bodies.indexOf(body);
      if (i !== -1) this.bodies.splice(i, 1);
    }

    clear() { this.bodies.length = 0; }

    resize(width, height) {
      this.width = width;
      this.height = height;
      this.bodies.forEach((b) => {
        b.x = Math.min(b.x, Math.max(0, width - b.w));
        if (b.y + b.h > height) { b.y = height - b.h; b.wake(); }
      });
    }

    /* Прижимает тело к стенкам и полу. Вызывается и после интеграции, и после
       каждой итерации расталкивания — иначе соседи продавливают нижние тела
       сквозь дно. */
    clamp(body, bounce) {
      if (body.x < 0) {
        body.x = 0;
        if (bounce) { body.vx = -body.vx * this.wallBounce; body.va *= 0.7; }
      }
      const right = this.width - body.w;
      if (body.x > right) {
        body.x = right;
        if (bounce) { body.vx = -body.vx * this.wallBounce; body.va *= 0.7; }
      }

      /* Не «зашло за пол», а «касается пола»: тело, лежащее ровно на дне,
         тоже должно гасить остаточную скорость, иначе оно вечно дребезжит
         с амплитудой в доли пикселя и никогда не засыпает. */
      const floor = this.height - body.h;
      if (body.y >= floor - 0.5) {
        if (body.y > floor) body.y = floor;
        if (bounce) {
          if (body.vy > BOUNCE_FROM) body.vy = -body.vy * body.restitution;
          else if (Math.abs(body.vy) < BOUNCE_FROM) body.vy = 0;
          body.vx *= body.friction;
          body.va *= 0.6;
        } else if (body.vy > 0) body.vy = 0;
        body.onFloor = true;
      }
    }

    grounded(body) {
      return body.y + body.h >= this.height - 0.5;
    }

    /* dt в секундах; шаг фиксируем снаружи, чтобы поведение не зависело от FPS */
    step(dt) {
      const bodies = this.bodies;

      for (const b of bodies) {
        if (b.sleeping) continue;
        b.vy += this.gravity * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.angle += b.va * dt;
        b.onFloor = false;
        this.clamp(b, true);
      }

      // снизу вверх: опора распространяется от пола к верхушке кучи
      bodies.sort((a, b) => (b.y + b.h) - (a.y + a.h));

      for (let pass = 0; pass < ITERATIONS; pass++) {
        this.solveCollisions();
        for (const b of bodies) this.clamp(b, false);
      }

      // засыпание: тело в покое и на опоре больше не считается
      for (const b of bodies) {
        if (b.sleeping) continue;
        const slow = Math.abs(b.vx) + Math.abs(b.vy) < SLEEP_SPEED;
        if (slow && (b.onFloor || b.supported)) {
          if (++b.still > SLEEP_FRAMES) {
            b.sleeping = true;
            b.vx = b.vy = b.va = 0;
          }
        } else b.still = 0;
      }
    }

    solveCollisions() {
      const bodies = this.bodies;
      for (const b of bodies) b.supported = b.onFloor;

      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          if (a.sleeping && b.sleeping) continue;

          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          if (overlapX <= 0) continue;
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapY <= 0) continue;

          /* Лёгкое касание спящего соседа не будит всю кучу — иначе стек
             просыпается каскадом от каждой новой вещи и никогда не замирает. */
          const light = Math.min(overlapX, overlapY) < SLOP * 3;
          if ((a.sleeping || b.sleeping) && light) continue;
          if (a.sleeping) a.wake();
          if (b.sleeping) b.wake();

          // расталкиваем по оси наименьшего проникновения
          if (overlapY < overlapX) {
            const upper = a.cy < b.cy ? a : b;
            const lower = upper === a ? b : a;

            /* Если нижнее тело упирается в дно или уже спит, двигать его некуда:
               весь сдвиг и весь импульс забирает верхнее. Иначе куча продавливает
               пол, а верхние тела вечно подпрыгивают и не засыпают. */
            /* Опора считается неподвижной, если стоит на дне, спит или сама уже
               получила опору в этом проходе. Пары идут снизу вверх, поэтому
               признак поднимается по башне и гасит скорость всей цепочки. */
            const lowerStatic = this.grounded(lower) || lower.sleeping || lower.supported;
            const full = Math.max(overlapY - SLOP, 0) * CORRECTION;
            const push = lowerStatic ? 0 : full * 0.5;
            upper.y -= full - push;
            lower.y += push;

            const rel = lower.vy - upper.vy;
            if (rel < 0) {
              /* Отскок только от заметного удара. Порог выше, чем прирост
                 скорости от гравитации за кадр, иначе лежащее тело бесконечно
                 подпрыгивает само от себя. */
              const e = Math.abs(rel) < BOUNCE_FROM ? 0 : Math.min(upper.restitution, lower.restitution);
              if (lowerStatic) {
                upper.vy = -upper.vy * e;
              } else {
                const imp = -(1 + e) * rel * 0.5;
                upper.vy -= imp;
                lower.vy += imp;
              }
            }
            upper.vx *= 0.92;
            if (!lowerStatic) lower.vx *= 0.92;
            upper.va *= 0.8;
            upper.supported = true;
          } else {
            const push = Math.max(overlapX - SLOP, 0) * CORRECTION * 0.5;
            const left = a.cx < b.cx ? a : b;
            const right = left === a ? b : a;
            left.x -= push;
            right.x += push;

            const rel = right.vx - left.vx;
            if (rel < 0) {
              const imp = -rel * 0.5;
              left.vx -= imp;
              right.vx += imp;
            }
          }
        }
      }
    }

    /* Все ли улеглись — по этому можно останавливать цикл отрисовки */
    get settled() {
      return this.bodies.every((b) => b.sleeping);
    }
  }

  const api = { World, Body };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { global.Physics = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
