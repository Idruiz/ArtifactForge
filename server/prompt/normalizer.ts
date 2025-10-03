import { routeIntent, type RouterResult, type DataAnalysisInput, type ResearchReportInput } from './orchestrator';

export type NormalizedRequest = RouterResult & {
  dataOrigin: 'user-provided-json' | 'synthetic-from-prompt' | 'topic-from-prompt';
  rawPrompt: string;
};

export class RequestNormalizer {
  
  normalize(rawPrompt: string): NormalizedRequest {
    let parsed: any = null;
    
    try {
      parsed = JSON.parse(rawPrompt);
    } catch {
    }
    
    if (parsed && (parsed.students || parsed.topic)) {
      const routed = routeIntent(parsed);
      return {
        ...routed,
        dataOrigin: 'user-provided-json',
        rawPrompt,
      };
    }
    
    const textBased = this.parseTextPrompt(rawPrompt);
    const routed = routeIntent(textBased);
    
    if (routed.intent === 'DATA_ANALYSIS_DOCX') {
      return {
        ...routed,
        dataOrigin: 'synthetic-from-prompt',
        rawPrompt,
      };
    }
    
    return {
      ...routed,
      dataOrigin: 'topic-from-prompt',
      rawPrompt,
    };
  }
  
  private parseTextPrompt(prompt: string): DataAnalysisInput | ResearchReportInput {
    const p = prompt.toLowerCase();
    
    const dataKeywords = [
      'analyze', 'analysis', 'metrics', 'performance', 'count', 'threshold',
      'average', 'below', 'above', 'students', 'skills'
    ];
    
    const hasNumericData = /\d+\s*(students|people|users|items|records|below|above)/.test(p);
    const dataMatches = dataKeywords.filter(k => p.includes(k));
    
    if (hasNumericData || dataMatches.length >= 2) {
      return this.parseAnalysisText(prompt);
    }
    
    return { topic: prompt };
  }
  
  private parseAnalysisText(prompt: string): DataAnalysisInput {
    const p = prompt.toLowerCase();
    
    let n_students = 20;
    const studentMatch = p.match(/(\d+)\s*students?/);
    if (studentMatch) n_students = parseInt(studentMatch[1]);
    
    let overall_avg = 75;
    const avgMatch = p.match(/average[:\s]+(\d+)/);
    if (avgMatch) overall_avg = parseInt(avgMatch[1]);
    
    const skills: Array<{ skill: string; below: number; cut: number }> = [];
    const skillPatterns = [
      { re: /(\d+)\s*below\s*(\d+)\s*(?:in|for)?\s*(\w+)/g, skill: 3, below: 1, cut: 2 },
      { re: /(\w+)[:\s]+(\d+)\s*below\s*(\d+)/g, skill: 1, below: 2, cut: 3 },
    ];
    
    for (const pattern of skillPatterns) {
      let match;
      while ((match = pattern.re.exec(p)) !== null) {
        skills.push({
          skill: match[pattern.skill],
          below: parseInt(match[pattern.below]),
          cut: parseInt(match[pattern.cut])
        });
      }
    }
    
    if (skills.length === 0) {
      skills.push(
        { skill: 'listening', below: 5, cut: 60 },
        { skill: 'writing', below: 4, cut: 70 },
        { skill: 'speaking', below: 10, cut: 65 }
      );
    }
    
    return {
      students: [],
      class_averages: undefined,
      _params: { n_students, skills, overall_avg }
    } as any;
  }
  
  private generateSyntheticStudents(count: number, skills: Array<{ skill: string; below: number; cut: number }>, overall_avg: number): any[] {
    const seed = Date.now();
    let rngState = seed;
    const random = () => {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    };
    
    const students: any[] = [];
    const firstNames = ['Ava', 'Liam', 'Sofia', 'Noah', 'Maya', 'Ethan', 'Mia', 'Lucas', 'Emma', 'Oliver'];
    const lastInitials = ['R.', 'T.', 'M.', 'P.', 'C.', 'K.', 'L.', 'S.', 'W.', 'H.'];
    
    for (let i = 0; i < count; i++) {
      const name = `${firstNames[i % firstNames.length]} ${lastInitials[i % lastInitials.length]}`;
      const student: any = { name };
      
      for (const { skill, below, cut } of skills) {
        const shouldBeBelow = i < below;
        if (shouldBeBelow) {
          student[`${skill}_pct`] = Math.floor(30 + random() * (cut - 30));
        } else {
          student[`${skill}_pct`] = Math.floor(cut + random() * (100 - cut));
        }
      }
      
      const avgScore = skills.length > 0
        ? skills.reduce((sum, { skill }) => sum + (student[`${skill}_pct`] || overall_avg), 0) / skills.length
        : overall_avg;
      
      student.test_pct = Math.floor(avgScore + (random() - 0.5) * 10);
      student.term_pct = Math.floor(avgScore + (random() - 0.5) * 10);
      student.attendance_pct = Math.floor(85 + random() * 15);
      student.missing_tasks = Math.floor(random() * 6);
      student.engagement_5 = Math.floor(1 + random() * 5);
      student.growth_pct = Math.floor(-5 + random() * 15);
      student.notes = this.generateNotes(student);
      
      students.push(student);
    }
    
    return students;
  }
  
  private generateNotes(student: any): string {
    const notes = [];
    if (student.test_pct >= 90) notes.push('strong performer');
    if (student.test_pct < 70) notes.push('needs support');
    if (student.attendance_pct < 90) notes.push('attendance concern');
    if (student.missing_tasks > 3) notes.push('missing assignments');
    if (student.engagement_5 >= 4) notes.push('highly engaged');
    if (student.engagement_5 <= 2) notes.push('low engagement');
    
    return notes.join('; ') || 'on track';
  }
  
  private computeClassAverages(students: any[]): any {
    if (students.length === 0) return {};
    
    const sum = (key: string) => students.reduce((s, st) => s + (st[key] || 0), 0);
    
    return {
      test_pct: Math.round((sum('test_pct') / students.length) * 10) / 10,
      term_pct: Math.round((sum('term_pct') / students.length) * 10) / 10,
      attendance_pct: Math.round((sum('attendance_pct') / students.length) * 10) / 10,
      missing_tasks_per_student: Math.round((sum('missing_tasks') / students.length) * 10) / 10,
      engagement_mean_5: Math.round((sum('engagement_5') / students.length) * 10) / 10,
    };
  }
}
