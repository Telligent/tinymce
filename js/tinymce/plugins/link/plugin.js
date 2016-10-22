/**
 * plugin.js
 *
 * Released under LGPL License.
 * Copyright (c) 1999-2015 Ephox Corp. All rights reserved
 *
 * License: http://www.tinymce.com/license
 * Contributing: http://www.tinymce.com/contributing
 */

/*global tinymce:true */

tinymce.PluginManager.add('link', function(editor) {
	var attachState = {};

	function isLink(elm) {
		return elm && elm.nodeName === 'A' && elm.href;
	}

	function hasLinks(elements) {
		return tinymce.util.Tools.grep(elements, isLink).length > 0;
	}

	function getSelectedLink() {
		return editor.dom.getParent(editor.selection.getStart(), 'a[href]');
	}

	function isContextMenuVisible() {
		var contextmenu = editor.plugins.contextmenu;
		return contextmenu ? contextmenu.isContextMenuVisible() : false;
	}

	function leftClickedOnAHref(elm) {
		var sel, rng, node;
		if (editor.settings.link_context_toolbar && !isContextMenuVisible() && isLink(elm)) {
			sel = editor.selection;
			rng = sel.getRng();
			node = rng.startContainer;
			// ignore cursor positions at the beginning/end (to make context toolbar less noisy)
			if (node.nodeType == 3 && sel.isCollapsed() && rng.startOffset > 0 && rng.startOffset < node.data.length) {
				return true;
			}
		}
		return false;
	}

	function isSafeTarget(target) {
		return tinymce.inArray(target, ['_top', '_self', '_parent']) !== -1;
	}

	/**
	 * Document opened with window.open(..., '_blank'), retains access to originating
	 * page through window.opener property, even across domain origins. This opens
	 * possibilities for phishing attacks by redirecting window.opener to some malicious
	 * address.
	 *
	 * Inspired by blankshield: https://github.com/danielstjules/blankshield
	 * The MIT License (MIT)
	 * Copyright (c) 2015 Daniel St. Jules
	 *
	 * @method openDetachedWindow
	 * @param {string} url
	 * @returns {window}
	 */
	function openDetachedWindow(url, target) {
		var win, iframe, iframeDoc, script;

		if (target && isSafeTarget(target)) {
			return open.call(window, url, target);
		}
		if (!tinymce.Env.ie) {
			iframe = document.createElement('iframe');
			iframe.style.display = 'none';
			document.body.appendChild(iframe);
			iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

			script = iframeDoc.createElement('script');
			script.text =
				'window.parent = window.top = window.frameElement = null;' +
				'var child = window.open("' + url + '", "_blank");' +
				'child.opener = null;';

			iframeDoc.body.appendChild(script);
			win = iframe.contentWindow.child;
			document.body.removeChild(iframe);
		} else {
			win = open.call(window, url, '_blank');
			win.opener = null;
		}
		return win;
	}

	function gotoHref() {
		var targetEl, a = getSelectedLink();
		if (!a) {
			return;
		}
		if (/^#/.test(a.href)) {
			targetEl = editor.$(a.href);
			if (targetEl.length) {
				editor.selection.scrollIntoView(targetEl[0], true);
			}
		} else {
			openDetachedWindow(a.href);
		}
	}

	function toggleViewLinkState() {
        var self = this;

        editor.on('nodechange', function(e) {
			if (hasLinks(e.parents)) {
				self.show();
			} else {
				self.hide();
			}
		});
	}

	function createLinkList(callback) {
		return function() {
			var linkList = editor.settings.link_list;

			if (typeof linkList == "string") {
				tinymce.util.XHR.send({
					url: linkList,
					success: function(text) {
						callback(tinymce.util.JSON.parse(text));
					}
				});
			} else if (typeof linkList == "function") {
				linkList(callback);
			} else {
				callback(linkList);
			}
		};
	}

	function buildListItems(inputList, itemCallback, startItems) {
		function appendItems(values, output) {
			output = output || [];

			tinymce.each(values, function(item) {
				var menuItem = {text: item.text || item.title};

				if (item.menu) {
					menuItem.menu = appendItems(item.menu);
				} else {
					menuItem.value = item.value;

					if (itemCallback) {
						itemCallback(menuItem);
					}
				}

				output.push(menuItem);
			});

			return output;
		}

		return appendItems(inputList, startItems || []);
	}

	function showDialog(linkList) {
		var data = {}, selection = editor.selection, dom = editor.dom, selectedElm, anchorElm, initialText;
		var win, onlyText, textListCtrl, linkListCtrl, relListCtrl, targetListCtrl, classListCtrl, linkTitleCtrl, value;

		function linkListChangeHandler(e) {
			var textCtrl = win.find('#text');

			if (!textCtrl.value() || (e.lastControl && textCtrl.value() == e.lastControl.text())) {
				textCtrl.value(e.control.text());
			}

			win.find('#href').value(e.control.value());
		}

		function buildAnchorListControl(url) {
			var anchorList = [];

			tinymce.each(editor.dom.select('a:not([href])'), function(anchor) {
				var id = anchor.name || anchor.id;

				if (id) {
					anchorList.push({
						text: id,
						value: '#' + id,
						selected: url.indexOf('#' + id) != -1
					});
				}
			});

			if (anchorList.length) {
				anchorList.unshift({text: 'None', value: ''});

				return {
					name: 'anchor',
					type: 'listbox',
					label: 'Anchors',
					values: anchorList,
					onselect: linkListChangeHandler
				};
			}
		}

		function updateText() {
			if (!initialText && data.text.length === 0 && onlyText) {
				this.parent().parent().find('#text')[0].value(this.value());
			}
		}

		function urlChange(e) {
			var meta = e.meta || {};

			if (linkListCtrl) {
				linkListCtrl.value(editor.convertURL(this.value(), 'href'));
			}

			tinymce.each(e.meta, function(value, key) {
				var inp = win.find('#' + key);

				if (key === 'text') {
					if (initialText.length === 0) {
						inp.value(value);
						data.text = value;
					}
				} else {
					inp.value(value);
				}
			});

			if (meta.attach) {
				attachState = {
					href: this.value(),
					attach: meta.attach
				};
			}

			if (!meta.text) {
				updateText.call(this);
			}
		}

		function isOnlyTextSelected(anchorElm) {
			var html = selection.getContent();

			// Partial html and not a fully selected anchor element
			if (/</.test(html) && (!/^<a [^>]+>[^<]+<\/a>$/.test(html) || html.indexOf('href=') == -1)) {
				return false;
			}

			if (anchorElm) {
				var nodes = anchorElm.childNodes, i;

				if (nodes.length === 0) {
					return false;
				}

				for (i = nodes.length - 1; i >= 0; i--) {
					if (nodes[i].nodeType != 3) {
						return false;
					}
				}
			}

			return true;
		}

		selectedElm = selection.getNode();
		anchorElm = dom.getParent(selectedElm, 'a[href]');
		onlyText = isOnlyTextSelected();

		data.text = initialText = anchorElm ? (anchorElm.innerText || anchorElm.textContent) : selection.getContent({format: 'text'});
		data.href = anchorElm ? dom.getAttrib(anchorElm, 'href') : '';

		if (anchorElm) {
			data.target = dom.getAttrib(anchorElm, 'target');
		} else if (editor.settings.default_link_target) {
			data.target = editor.settings.default_link_target;
		}

		if ((value = dom.getAttrib(anchorElm, 'rel'))) {
			data.rel = value;
		}

		if ((value = dom.getAttrib(anchorElm, 'class'))) {
			data['class'] = value;
		}

		if ((value = dom.getAttrib(anchorElm, 'title'))) {
			data.title = value;
		}

		if (onlyText) {
			textListCtrl = {
				name: 'text',
				type: 'textbox',
				size: 40,
				label: 'Text to display',
				onchange: function() {
					data.text = this.value();
				}
			};
		}

		if (linkList) {
			linkListCtrl = {
				type: 'listbox',
				label: 'Link list',
				values: buildListItems(
					linkList,
					function(item) {
						item.value = editor.convertURL(item.value || item.url, 'href');
					},
					[{text: 'None', value: ''}]
				),
				onselect: linkListChangeHandler,
				value: editor.convertURL(data.href, 'href'),
				onPostRender: function() {
					/*eslint consistent-this:0*/
					linkListCtrl = this;
				}
			};
		}

		if (editor.settings.target_list !== false) {
			if (!editor.settings.target_list) {
				editor.settings.target_list = [
					{text: 'None', value: ''},
					{text: 'New window', value: '_blank'}
				];
			}

			targetListCtrl = {
				name: 'target',
				type: 'listbox',
				label: 'Target',
				values: buildListItems(editor.settings.target_list)
			};
		}

		if (editor.settings.rel_list) {
			relListCtrl = {
				name: 'rel',
				type: 'listbox',
				label: 'Rel',
				values: buildListItems(editor.settings.rel_list)
			};
		}

		if (editor.settings.link_class_list) {
			classListCtrl = {
				name: 'class',
				type: 'listbox',
				label: 'Class',
				values: buildListItems(
					editor.settings.link_class_list,
					function(item) {
						if (item.value) {
							item.textStyle = function() {
								return editor.formatter.getCssText({inline: 'a', classes: [item.value]});
							};
						}
					}
				)
			};
		}

		if (editor.settings.link_title !== false) {
			linkTitleCtrl = {
				name: 'title',
				type: 'textbox',
				label: 'Title',
				value: data.title
			};
		}

		win = editor.windowManager.open({
			title: 'Insert link',
			data: data,
			body: [
				{
					name: 'href',
					type: 'filepicker',
					filetype: 'file',
					size: 40,
					autofocus: true,
					label: 'Url',
					onchange: urlChange,
					onkeyup: updateText
				},
				textListCtrl,
				linkTitleCtrl,
				buildAnchorListControl(data.href),
				linkListCtrl,
				relListCtrl,
				targetListCtrl,
				classListCtrl
			],
			onSubmit: function(e) {
				/*eslint dot-notation: 0*/
				var href;

				data = tinymce.extend(data, e.data);
				href = data.href;

				// Delay confirm since onSubmit will move focus
				function delayedConfirm(message, callback) {
					var rng = editor.selection.getRng();

					tinymce.util.Delay.setEditorTimeout(editor, function() {
						editor.windowManager.confirm(message, function(state) {
							editor.selection.setRng(rng);
							callback(state);
						});
					});
				}

				function createLink() {
					var linkAttrs = {
						href: href,
						target: data.target ? data.target : null,
						rel: data.rel ? data.rel : null,
						"class": data["class"] ? data["class"] : null,
						title: data.title ? data.title : null
					};

					if (!editor.settings.allow_unsafe_link_target && !linkAttrs.rel && !isSafeTarget(linkAttrs.target)) {
						linkAttrs.rel = 'noopener noreferrer';
					}

					if (href === attachState.href) {
						attachState.attach();
						attachState = {};
					}

					if (anchorElm) {
						editor.focus();

						if (onlyText && data.text != initialText) {
							if ("innerText" in anchorElm) {
								anchorElm.innerText = data.text;
							} else {
								anchorElm.textContent = data.text;
							}
						}

						dom.setAttribs(anchorElm, linkAttrs);

						selection.select(anchorElm);
						editor.undoManager.add();
					} else {
						if (onlyText) {
							editor.insertContent(dom.createHTML('a', linkAttrs, dom.encode(data.text)));
						} else {
							editor.execCommand('mceInsertLink', false, linkAttrs);
						}
					}
				}

				function insertLink() {
					editor.undoManager.transact(createLink);
				}

				if (!href) {
					editor.execCommand('unlink');
					return;
				}

				// Is email and not //user@domain.com
				if (href.indexOf('@') > 0 && href.indexOf('//') == -1 && href.indexOf('mailto:') == -1) {
					delayedConfirm(
						'The URL you entered seems to be an email address. Do you want to add the required mailto: prefix?',
						function(state) {
							if (state) {
								href = 'mailto:' + href;
							}

							insertLink();
						}
					);

					return;
				}

				// Is not protocol prefixed
				if ((editor.settings.link_assume_external_targets && !/^\w+:/i.test(href)) ||
					(!editor.settings.link_assume_external_targets && /^\s*www[\.|\d\.]/i.test(href))) {
					delayedConfirm(
						'The URL you entered seems to be an external link. Do you want to add the required http:// prefix?',
						function(state) {
							if (state) {
								href = 'http://' + href;
							}

							insertLink();
						}
					);

					return;
				}

				insertLink();
			}
		});
	}

	editor.addButton('link', {
		icon: 'link',
		tooltip: 'Insert/edit link',
		shortcut: 'Meta+K',
		onclick: createLinkList(showDialog),
		stateSelector: 'a[href]'
	});

	editor.addButton('unlink', {
		icon: 'unlink',
		tooltip: 'Remove link',
		cmd: 'unlink',
		stateSelector: 'a[href]'
	});


	if (editor.addContextToolbar) {
		editor.addButton('gotolink', {
			icon: 'preview',
			tooltip: 'View link',
			onclick: gotoHref
		});

		editor.addContextToolbar(
			leftClickedOnAHref,
			'gotolink | link unlink'
		);
	}


	editor.addShortcut('Meta+K', '', createLinkList(showDialog));
	editor.addCommand('mceLink', createLinkList(showDialog));

	this.showDialog = showDialog;

	editor.addMenuItem('gotolink', {
		text: 'View link',
		onclick: gotoHref,
		onPostRender: toggleViewLinkState,
		prependToContext: true
	});

	editor.addMenuItem('link', {
		icon: 'link',
		text: 'Link',
		shortcut: 'Meta+K',
		onclick: createLinkList(showDialog),
		stateSelector: 'a[href]',
		context: 'insert',
		prependToContext: true
	});
});
