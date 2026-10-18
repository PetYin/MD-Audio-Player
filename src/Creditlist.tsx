import credits from '../shared/credits.json';
import Modal from './Modal';

export default function Creditlist({ onClose }: { onClose: () => void }) {
  return <Modal title="Creditlist · 第三方软件与致谢" eyebrow="ACKNOWLEDGEMENTS" onClose={onClose} wide>
    <div className="creditlist">
      <p className="credits-intro">{credits.intro}</p>
      <section className="credits-rights" aria-label={credits.rights.title}>
        <h3>{credits.rights.title}</h3>
        {credits.rights.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        <p className="credits-attribution">{credits.rights.attribution.map(line => <span key={line}>{line}</span>)}</p>
      </section>
      {credits.sections.map(section => <details className="credits-group" key={section.id} open={section.id !== 'build-test'}>
        <summary>{section.title}<span>{section.entries.length} 项</span></summary>
        <p className="credits-note">{section.note}</p>
        <ul className="credits-list">{section.entries.map(entry => <li key={entry.name}>
          <div className="credits-entry-heading"><h4>{entry.name}</h4><span>{entry.version}</span></div>
          <p>{entry.purpose}</p><p className="credits-license">许可：{entry.license}</p>
        </li>)}</ul>
      </details>)}
      <section className="credits-documents" aria-label="完整许可与源码说明">
        <h3>完整许可与源码说明</h3>
        <p>以下文件可在播放器文件夹中离线查看。</p>
        <dl>{credits.documents.map(document => <div key={document.path}><dt><code>{document.path}</code></dt><dd>{document.description}</dd></div>)}</dl>
        <p>{credits.closing}</p>
      </section>
    </div>
    <div className="modal-actions"><button className="button" onClick={onClose}>返回设置</button></div>
  </Modal>;
}
