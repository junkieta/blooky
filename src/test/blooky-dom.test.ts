    /**
     * @jest-environment jsdom
     */
    // blooky-dom.test.ts

    // --- 型定義とテスト対象のインポート ---
    // 実際のプロジェクトのパスに合わせて修正してください
    import type { JSHTMLNodeSource } from '../blooky-dom-types';
    import {
        jshtml,
        promised,
        defineAttrUpdateHandlers,
        listenerForCollapse,
        mutations,
        prime,
    } from '../blooky-dom';
    import { stream, hold, drip, collapse } from '../blooky-fp';
    import { DripperStream, Prop } from '../blooky-types';

    describe('blooky-dom.ts', () => {

        // 各テストの前にDOMをクリーンアップする
        beforeEach(() => {
            document.body.innerHTML = '';
            // Jestのタイマーモックを有効にする
            jest.useFakeTimers({
                advanceTimers: true,
                timerLimit: 1000
            });
        });

        afterEach(() => {
            jest.useRealTimers();
        });


        // =================================
        // jshtml: コアDOM生成関数
        // =================================
        describe('jshtml()', () => {

            // --- 基本的なノード生成 ---
            describe('Basic Node Creation', () => {
                test('should create an element with text content', () => {
                    const el = jshtml({ div: 'Hello World' }) as HTMLElement;
                    expect(el.tagName).toBe('DIV');
                    expect(el.textContent).toBe('Hello World');
                });

                test('should handle various primitive types as text nodes', () => {
                    expect((jshtml(123) as Text).textContent).toBe('123');
                    expect((jshtml('string') as Text).textContent).toBe('string');
                    expect((jshtml(null) as Comment).nodeName).toBe('#comment');
                    expect((jshtml(undefined) as Comment).nodeName).toBe('#comment');
                });

                test('should create nested elements', () => {
                    const el = jshtml({ p: { span: 'content' } }) as HTMLParagraphElement;
                    expect(el.outerHTML).toBe('<p><span>content</span></p>');
                });

                test('should handle arrays of nodes as siblings', () => {
                    const fragment = jshtml([
                        { b: 'Bold' },
                        ' and ',
                        { i: 'Italic' }
                    ]) as DocumentFragment;
                    const div = document.createElement('div');
                    div.append(fragment);
                    expect(div.innerHTML).toBe('<b>Bold</b> and <i>Italic</i>');
                });

                test('should return existing nodes as they are', () => {
                    const existingDiv = document.createElement('div');
                    const result = jshtml(existingDiv);
                    expect(result).toBe(existingDiv);
                });
            });

            // --- 属性の適用 ---
            describe('Attribute Application', () => {
                test('should set standard attributes', () => {
                    const el = jshtml({ a: null, $: { href: '#', id: 'link' } }) as HTMLAnchorElement;
                    expect(el.id).toBe('link');
                    expect(el.getAttribute('href')).toBe('#');
                });

                test('should set boolean attributes', () => {
                    const el = jshtml({ button: null, $: { disabled: true } }) as HTMLButtonElement;
                    expect(el.disabled).toBe(true);
                    const el2 = jshtml({ button: null, $: { disabled: false } }) as HTMLButtonElement;
                    expect(el2.disabled).toBe(false);
                });

                test('should handle class attribute (string, array, object)', () => {
                    const el1 = jshtml({ div: null, $: { class: 'a b' } }) as HTMLElement;
                    expect(el1.className).toBe('a b');

                    const el2 = jshtml({ div: null, $: { class: ['a', 'c'] } }) as HTMLElement;
                    expect(el2.className).toBe('a c');

                    const el3 = jshtml({ div: null, $: { class: { a: true, b: false, c: true } } }) as HTMLElement;
                    expect(el3.className).toBe('a c');
                });

                test('should handle style attribute', () => {
                    const el = jshtml({ div: null, $: { style: { color: 'red', margin: '10px' } } }) as HTMLElement;
                    expect(el.style.color).toBe('red');
                    expect(el.style.margin).toBe('10px');
                });
            });

            // --- リアクティブな更新 (Prop) ---
            describe('Reactive Updates with Props', () => {
                test('should update text content when a Prop changes', async () => {
                    const s = stream<string>();
                    const textProp = hold('Initial')(s);
                    const el = jshtml({ p: textProp }) as HTMLParagraphElement;
                    document.body.append(el);

                    expect(el.textContent).toBe('Initial');

                    await collapse(drip('Updated')(s));
                    
                    // Propが更新されると、DOMのテキストも更新される
                    expect(document.body.innerHTML).toBe('<p>Updated</p>');
                });

                test('should update an attribute when a Prop changes', async () => {
                    const s = stream<string>();
                    const idProp = hold('first-id')(s);
                    const el = jshtml({ div: null, $: { id: idProp } }) as HTMLElement;
                    document.body.append(el);

                    expect(el.id).toBe('first-id');

                    await collapse(drip('second-id')(s));

                    expect(el.id).toBe('second-id');
                });

                test('should update a style property when a Prop changes', async () => {
                    const s = stream<string>();
                    const colorProp = hold('red')(s);
                    const el = jshtml({ div: null, $: { style: { color: colorProp } } }) as HTMLElement;
                    document.body.append(el);

                    expect(el.style.color).toBe('red');

                    await collapse(drip('blue')(s));

                    expect(el.style.color).toBe('blue');
                });

                test('should replace a node when a Node-Prop changes', async () => {
                    const s = stream<JSHTMLNodeSource>();
                    const nodeProp = hold<JSHTMLNodeSource>({ b: 'Bold' })(s);
                    const container = jshtml({ div: [ 'Content: ', nodeProp ]}) as HTMLElement;
                    document.body.append(container);
                    
                    expect(container.innerHTML).toBe('Content: <b>Bold</b>');

                    await collapse(drip({ i: 'Italic' } as JSHTMLNodeSource)(s));
                    
                    expect(container.innerHTML).toBe('Content: <i>Italic</i>');
                });
            });

            // --- イベントリスナー ---
            describe('Event Listeners', () => {
                test('should attach an event listener that triggers a stream', () => {
                    const clickStream = stream<MouseEvent>();
                    const listener = jest.fn();
                    // streamを直接テストするのは難しいので、副作用を監視
                    clickStream.next.add({
                        next: new Set(),
                        lazyNext: new Set(),
                        mapFn: listener
                    } as any);

                    const el = jshtml({ button: null, $: { onclick: clickStream } }) as HTMLButtonElement;
                    
                    el.click();

                    expect(listener).toHaveBeenCalledTimes(1);
                });
            });
        });

        // =================================
        // promised: 非同期処理
        // =================================
        describe('promised()', () => {
            test('should show a placeholder and replace it on promise resolution', async () => {
                let resolvePromise: (value: JSHTMLNodeSource) => void;
                const p = new Promise<JSHTMLNodeSource>(resolve => {
                    resolvePromise = resolve;
                });
                
                const el = promised(p, 'Loading...');
                document.body.append(el);

                expect(document.body.innerHTML).toBe('<blooky-promised-placeholder>Loading...</blooky-promised-placeholder>');

                // Promiseを解決する
                resolvePromise!({ div: 'Loaded!' });
                // Microtaskキューをフラッシュして、thenブロックを実行させる
                await Promise.resolve();
                await Promise.resolve();

                expect(document.body.innerHTML).toBe('<div>Loaded!</div>');
            });
        });

        // =================================
        // prime: レンダラー生成
        // =================================
        describe('prime()', () => {
            test('should create a renderer function', () => {
                type Context = { name: string, onClick: DripperStream<MouseEvent> };
                const template = (ctx: Context) => ({
                    button: {
                        $: { onclick: ctx.onClick },
                        _: `Click ${ctx.name}`
                    }
                });

                const render = prime(template);
                const s = stream<MouseEvent>();
                const el = render({ name: 'me', onClick: s }) as HTMLButtonElement;

                expect(el.tagName).toBe('BUTTON');
                expect(el.textContent).toBe('Click me');
            });
        });

        // =================================
        // defineAttrUpdateHandlers: カスタム属性
        // =================================
        describe('defineAttrUpdateHandlers()', () => {
            test('should allow defining custom attribute handlers', () => {
                const handler = jest.fn();
                defineAttrUpdateHandlers({
                    'custom-attr': handler
                });

                const el = jshtml({ div: null, $: { 'custom-attr': 'my-value' } });

                expect(handler).toHaveBeenCalledTimes(1);
                expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                    target: el,
                    name: 'custom-attr',
                    value: 'my-value'
                }));
            });
        });

        // =================================
        // mutations: DOM変更監視
        // =================================
        describe('mutations()', () => {
            // MutationObserverのモック
            const mockObserve = jest.fn();
            const mockDisconnect = jest.fn();
            const MockMutationObserver = jest.fn((callback) => ({
                observe: mockObserve,
                disconnect: mockDisconnect,
                takeRecords: jest.fn(),
            }));
            
            beforeAll(() => {
                global.MutationObserver = MockMutationObserver;
            });
            
            test('should create a stream that observes DOM mutations', () => {
                const div = document.createElement('div');
                const mutationStream = mutations({ childList: true })(div);

                expect(MockMutationObserver).toHaveBeenCalled();
                expect(mockObserve).toHaveBeenCalledWith(div, { childList: true });
            });
        });
    });