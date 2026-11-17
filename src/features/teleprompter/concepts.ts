// Small bilingual concept vocabulary for local phrase matching. Unlisted terms
// still participate as literal content words, so domain terms are preserved.
const families = {
  proposal: 'usul mengusulkan saran menyarankan rekomendasi merekomendasikan anjur ajukan mengajukan proposal propose suggest recommend',
  improve: 'tingkat meningkat peningkatan meningkatkan ditingkatkan perbaikan memperbaiki diperbaiki perbaiki membaik perkuat memperkuat diperkuat lebihbaik lebihbagus improvement improve better strengthen',
  coordination: 'koordinasi koordinasikan koordinir sinkronisasi sinkron kolaborasi kolaboratif integrasi terintegrasi sinergi kerjasama bekerjasama bekerjaerat bekerja terhubung coordination coordinate collaboration collaborate integration integrate cooperation cooperate',
  institution: 'instansi antarinstansi lembaga antarlembaga badan organisasi institusi unit institution institutions agency agencies organization organizations',
  policy: 'kebijakan regulasi peraturan aturan ketentuan policy policies regulation regulations rule rules',
  execution: 'jalan berjalan jalankan menjalankan dijalankan pelaksanaan laksanakan melaksanakan dilaksanakan implementasi menerapkan diterapkan penerapan eksekusi melaksana execution execute implement implementation carryout',
  effective: 'efektif efektivitas efektifitas efisien efisiensi optimal optimalisasi berhasil sukses tepatguna effective effectiveness efficient efficiency success successful',
  conclusion: 'simpulan kesimpulan kesimpulannya simpulkan menyimpulkan akhirnya intinya ringkas rangkuman ringkasan akhir conclusion concluding finally summary summarize takeaway inshort',
  impact: 'dampak efek pengaruh manfaat hasil outcome outcomes impact effect benefit benefits result results',
  evaluation: 'evaluasi menilai penilaian asesmen analisis menganalisis tinjau meninjau pantau memantau monitoring ukur mengukur assess assessment review monitor monitoring evaluate evaluation measure',
  plan: 'rencana merencanakan perencanaan strategi strategis taktik pendekatan langkah approach strategy strategic tactic plan planning action',
  goal: 'tujuan sasaran target objektif goal goals objective objectives target targets aim',
  customer: 'pelanggan konsumen pengguna nasabah pemakai user users customer customers consumer consumers client clients',
  communication: 'komunikasi berkomunikasi diskusi berdiskusi dialog percakapan bicara membicarakan discussion discuss dialogue communication communicate talk',
  team: 'tim kelompok regu anggota rekan kolega team group colleague colleagues teammates',
  issue: 'masalah permasalahan kendala hambatan tantangan problem problems challenge challenges issue issues obstacle obstacles',
  resolve: 'solusi selesaikan menyelesaikan penyelesaian mengatasi atasi pecahkan pemecahan solve solution resolve resolution',
  priority: 'prioritas prioritaskan mengutamakan utama fokus utamakan priority prioritize prioritise focus',
  evidence: 'bukti data fakta evidensi evidence facts fact statistics statistik',
  cost: 'biaya anggaran belanja dana pengeluaran budget cost costs spending expense expenses',
  decrease: 'turun menurun menurunkan penurunan kurang mengurangi pengurangan hemat penghematan berkurang reduce decrease reduction save savings',
  speed: 'cepat percepat mempercepat kecepatan lekas acceleration accelerate fast faster speed expedite',
  accessibility: 'akses aksesibilitas aksesibel terjangkau mudahdijangkau accessibility accessible reach reachable',
  digital: 'digital daring online internet',
  equality: 'setara kesetaraan merata pemerataan inklusif inklusi equitable equity equality inclusive inclusion',
  risk: 'risiko resiko risiko-risiko ancaman bahaya risk risks threat threats danger',
  transparent: 'transparan transparansi terbuka keterbukaan transparent transparency openness',
  service: 'layanan pelayanan melayani service services serve',
  quality: 'kualitas mutu quality standard standar',
  feedback: 'masukan umpanbalik tanggapan respons respon feedback response responses',
  change: 'ubah perubahan mengubah penyesuaian sesuaikan adaptasi adapt adjust adjustment change changes',
  maintain: 'jaga menjaga pertahankan mempertahankan rawat memelihara maintain retain preserve protect',
} satisfies Record<string, string>;

const conceptOf = new Map(Object.entries(families).flatMap(([concept, aliases]) =>
  aliases.split(' ').map((alias) => [alias, concept] as const)));

const nonContent = new Set(('a ada adalah agak akan aku aja agar alhasil anda and antara apa as atau bahwa bagi banyak baru beberapa bila karena ' +
  'banget beliau bisa bukan can cuma dalam dan dapat dari dengan dia dikit di do for get have he i in ini is itu jadi juga ' +
  'kalian kalau kan kami kamu ke ketika kita kok lagi lah lebih mana masih may masing mau memang mereka meski must nah namun ' +
  'of oh ok oke on or pada para perlu pun rasanya saja salah sama saya sebagai sebelum secara sedang sejak setelah serta she ' +
  'should si sudah supaya tak tapi telah tentang terhadap that the then there they tidak to tuh untuk was we will with would ' +
  'ya yang you eh em hmm um uh anu menurut menyampaikan begitu demikian').split(' '));

export function isContent(term: string): boolean {
  return term.length >= 2 && !nonContent.has(term);
}

export function conceptSet(terms: readonly string[]): Set<string> {
  const concepts = new Set<string>();
  for (let index = 0; index < terms.length; index++) {
    const term = terms[index];
    const compound = conceptOf.get(term + (terms[index + 1] ?? ''));
    if (terms[index + 1] && compound) {
      concepts.add(compound);
      index++;
    } else if (isContent(term)) {
      concepts.add(conceptOf.get(term.replaceAll('-', '')) ?? term);
    }
  }
  return concepts;
}
