import MarkupIt, { BLOCKS, INLINES, TABLE_ALIGN, MARKS, CONTAINERS, VOID } from 'markup-it';
import markdown from 'markup-it/lib/markdown';
import React, { Component, PropTypes } from 'react';
import Slate, { Editor, State, Text, Inline, Block } from 'slate';

import schema from '../constants/SlateSchema';

const OPTIONS = { normalize: false };

class SlateEditor extends Component {
  static propTypes = {
    note: PropTypes.object,
    onChange: PropTypes.func.isRequired,
  };

  state = {
    state: deserializeToState(''),
  };

  componentWillReceiveProps(nextProps) {
    if (!nextProps.note.isMarkdown) {
      console.error('Only markdown note is supported');
      return;
    }

    this.setState({
      state: deserializeToState(nextProps.note.content),
    });
  }

  render() {
    return (
      <div className="editor">
        <Editor
          className="slate-editor markdown-body"
          onBlur={this.onBlur}
          onChange={this.onChange}
          onDocumentChange={this.onDocumentChange}
          onKeyDown={this.onKeyDown}
          onPaste={this.onPaste}
          onSelectionChange={this.onSelectionChange}
          placeholder="Enter text here..."
          ref="slate"
          schema={schema}
          state={this.state.state}
        />
      </div>
    )
  }

  onPaste = () => {
    // 粘贴的图片都上传
  }

  onSelectionChange = (selection, state) => {
    const { startBlock, startOffset, startText } = state;
    if (startText) {
      // 刚刚编辑完一个link，将markdown源码解析成link
      const linkRegex = /\[([^\]]*)\]\(([^\)]*)\)/;
      const match = linkRegex.exec(startText.text);
      // console.log(startText.text, match);
      if (match && match.length === 3) {
        console.warn('insert link node', startBlock.key);
        const from = match.index, to = match.index + match[0].length;
        const $before = Text.createFromString(startText.text.substring(0, from));
        const $link = Inline.create({
          type: INLINES.LINK,
          data: { href: match[2] },
          isVoid: false,
          nodes: [Text.createFromString(match[1])],
        });
        const $after = Text.createFromString(startText.text.substring(to));

        const nextState = replaceWith(state, startText, [$before, $link, $after]);
        this.setState({ state: nextState });
      }
    }
    // TODO 用户进入一个link，将link替换成markdown源码
    const parent = state.document.getParent(startText.key);
    if (parent.type === INLINES.LINK && parent.nodes.length === 1) {
      console.log('link found, inline:', prettify(parent));
      const nextState = state.transform()
        // .removeNodeByKey(parent.key)
        .insertNodeByKey(parent.key, 1, Text.createFromString('(www.baidu.com)'))
        .apply(OPTIONS);
      this.setState({ state: nextState });
    }
  }

  onBlur = () => {
    const text = serializeState(this.state.state);
    if (text !== this.props.note.content) {
      this.props.onChange(text);
    }
  }

  onChange = (state) => {
    this.setState({ state })
  }

  onKeyDown = (e, data, state) => {
    switch (data.key) {
      case 'space': return this.onSpace(e, state)
      case 'backspace': return this.onBackspace(e, state)
      case 'enter': return this.onEnter(e, state)
    }
  }

  /**
   * Get the block type for a series of auto-markdown shortcut `chars`.
   *
   * @param {String} chars
   * @return {String} block
   */
  getType = (chars) => {
    switch (chars) {
      case '*':
      case '-':
      case '+': return BLOCKS.LIST_ITEM;
      case '>': return BLOCKS.BLOCKQUOTE;
      case '#': return BLOCKS.HEADING_1;
      case '##': return BLOCKS.HEADING_2;
      case '###': return BLOCKS.HEADING_3;
      case '####': return BLOCKS.HEADING_4;
      case '#####': return BLOCKS.HEADING_5;
      case '######': return BLOCKS.HEADING_6;
      default: return null
    }
  }

  /**
   * On space, if it was after an auto-markdown shortcut, convert the current
   * node into the shortcut's corresponding type.
   *
   * @param {Event} e
   * @param {State} state
   * @return {State or Null} state
   */
  onSpace = (e, state) => {
    if (state.isExpanded) return
    const { startBlock, startOffset } = state
    const chars = startBlock.text.slice(0, startOffset).replace(/\s*/g, '')
    const type = this.getType(chars)

    if (!type) return
    if (type == BLOCKS.LIST_ITEM && startBlock.type == BLOCKS.LIST_ITEM) return
    e.preventDefault()

    let transform = state
      .transform()
      .setBlock(type)

    if (type == BLOCKS.LIST_ITEM) transform.wrapBlock(BLOCKS.UL_LIST)

    state = transform
      .extendToStartOf(startBlock)
      .delete()
      .apply()

    return state
  }

  /**
   * On backspace, if at the start of a non-paragraph, convert it back into a
   * paragraph node.
   *
   * @param {Event} e
   * @param {State} state
   * @return {State or Null} state
   */
  onBackspace = (e, state) => {
    if (state.isExpanded) return
    if (state.startOffset != 0) return
    const { startBlock } = state
    if (startBlock.type == BLOCKS.PARAGRAPH) return
    if (startBlock.length === 0 && startBlock.text === '') {
      return
    }
    e.preventDefault()

    let transform = state
      .transform()
      .setBlock(BLOCKS.PARAGRAPH)

    if (startBlock.type == BLOCKS.LIST_ITEM) transform.unwrapBlock(BLOCKS.UL_LIST)

    state = transform.apply()
    return state
  }

  /**
   * On return, if at the end of a node type that should not be extended,
   * create a new paragraph below it.
   *
   * @param {Event} e
   * @param {State} state
   * @return {State or Null} state
   */
  onEnter = (e, state) => {
    if (state.isExpanded) return
    const { startBlock, startOffset, endOffset } = state
    if (startOffset == 0 && startBlock.length == 0) return this.onBackspace(e, state)
    if (endOffset != startBlock.length) return

    if (
      startBlock.type != BLOCKS.HEADING_1 &&
      startBlock.type != BLOCKS.HEADING_2 &&
      startBlock.type != BLOCKS.HEADING_3 &&
      startBlock.type != BLOCKS.HEADING_4 &&
      startBlock.type != BLOCKS.HEADING_5 &&
      startBlock.type != BLOCKS.HEADING_6 &&
      startBlock.type != BLOCKS.BLOCKQUOTE
    ) {
      return
    }

    e.preventDefault()
    return state
      .transform()
      .splitBlock()
      .setBlock(BLOCKS.PARAGRAPH)
      .apply()
  }
}

/**
 * Transform Slate.state to markdown
 */
function serializeState(state) {
  const text = MarkupIt.State.create(markdown).serializeDocument(state.document);
  return text;
}

/**
 * Transform markdown to Slate.state
 */
function deserializeToState(text) {
  const document = MarkupIt.State.create(markdown).deserializeToDocument(text);
  const state = Slate.State.create({ document });
  // trim empty spans
  const blocks = state.document.getBlocks();
  const transform = state.transform();
  blocks.forEach(block => {
    block.nodes.forEach(node => {
      if (node.text === '' && node.key !== '0') {
        transform.removeNodeByKey(node.key, OPTIONS);
      }
    });
  });
  return transform.apply({ normalize: false });
}

function prettify(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function replaceWith(state, prevNode, newNodes) {
  const parent = state.document.getParent(prevNode);
  const transform = state.transform();
  const index = parent.nodes.find(node => node.key === prevNode.key);
  transform.removeNodeByKey(prevNode.key);
  newNodes.reverse().forEach(newNode => transform.insertNodeByKey(parent.key, index, newNode));
  return transform.apply(OPTIONS);
}

export default SlateEditor
