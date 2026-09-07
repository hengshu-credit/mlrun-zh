import React from 'react'
import { setLocale, useLocale } from './locale'
import './language-selector.css'

export default function LanguageSelector() {
  const locale = useLocale()
  return (
    <label className="mlrun-language-selector">
      <span aria-hidden="true">文 / EN</span>
      <select
        aria-label="语言 / Language"
        value={locale}
        onChange={event => setLocale(event.target.value)}
        data-testid="language-selector"
      >
        <option value="zh-CN" lang="zh-CN">简体中文</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
  )
}
